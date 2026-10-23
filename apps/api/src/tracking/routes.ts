import { type Request, type Response, Router } from "express";
import { getSequenceRowBySequenceId } from "../automation/queries";
import { EmailEventAction, TEST_UNSUBSCRIBE_TOKEN } from "../config/constants";
import {
  getContactByContactId,
  getContactByUnsubscribeToken,
  updateContact,
} from "../contacts/queries";
import { db } from "../db/client";
import { emailEvents } from "../db/schema";
import { captureError, captureEvent } from "../observability";
import { getSequenceEmailByEmailId } from "../sequences/queries";
import logger from "../services/log";
import {
  incrementTransactionalEmailClickCount,
  incrementTransactionalEmailOpenCount,
} from "../transactional/queries";
import { verifyPixelToken } from "../utils/pixel-jwt";
import {
  invalidUnsubscribeLinkPage,
  testUnsubscribePage,
  unsubscribeConfirmPage,
  unsubscribedPage,
} from "./unsubscribe-page";

const router = Router();

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64",
);

interface TeamScopedEvent {
  contactId: string;
  sequenceId: string;
  emailId: string;
  index?: number;
  link?: string;
  [key: string]: unknown;
}

/** Transactional pixel/click tokens carry `type: "txe"` (see
 * `mail/worker.ts#processTransactionalJob`); campaign tokens carry no `type`
 * field at all, so a plain truthiness check on `payload.type` is enough to
 * route between the two without disturbing tokens already embedded in mail
 * delivered before this branch existed. */
interface TransactionalScopedEvent {
  type: "txe";
  txeId: string;
  index?: number;
  link?: string;
  [key: string]: unknown;
}

function isTransactionalPayload(
  payload: Record<string, unknown>,
): payload is TransactionalScopedEvent {
  return payload.type === "txe";
}

// Open-tracking pixel embedded in outgoing mail.
router.get("/track/open", async (req: Request, res: Response) => {
  const token = String(req.query.d || "");
  const payload = verifyPixelToken<Record<string, unknown>>(token);

  res.set("Content-Type", "image/gif");
  res.send(TRANSPARENT_GIF);

  if (!payload) return;
  try {
    if (isTransactionalPayload(payload)) {
      await incrementTransactionalEmailOpenCount(payload.txeId);
      captureEvent({
        event: "transactional_email_opened",
        source: "tracking.open",
        properties: { txe_id: payload.txeId },
      });
      return;
    }

    const resolved = await resolveEventIds(payload as TeamScopedEvent);
    if (!resolved) return;
    await db.insert(emailEvents).values({
      teamId: resolved.teamId,
      sequenceId: resolved.sequenceId,
      contactId: resolved.contactId,
      emailId: resolved.emailId,
      action: EmailEventAction.OPEN,
    });
    captureEvent({
      event: "email_opened",
      source: "tracking.open",
      teamId: resolved.teamId,
      properties: {
        sequence_id: resolved.sequenceId,
        email_id: resolved.emailId,
      },
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to record open event");
    captureError({
      error: err,
      source: "tracking.open",
      context: { route: "/track/open" },
    });
  }
});

// Click-tracking redirect embedded in outgoing mail links.
router.get("/track/click", async (req: Request, res: Response) => {
  const token = String(req.query.d || "");
  const payload = verifyPixelToken<Record<string, unknown>>(token);
  if (!payload || typeof payload.link !== "string" || !payload.link) {
    return res.status(400).send("Invalid tracking link");
  }

  let destination: string;
  try {
    destination = decodeURIComponent(payload.link);
  } catch {
    return res.status(400).send("Invalid tracking link");
  }

  try {
    if (isTransactionalPayload(payload)) {
      await incrementTransactionalEmailClickCount(payload.txeId);
      captureEvent({
        event: "transactional_email_link_clicked",
        source: "tracking.click",
        properties: {
          txe_id: payload.txeId,
          link_index: payload.index,
        },
      });
    } else {
      const resolved = await resolveEventIds(payload as TeamScopedEvent);
      if (resolved) {
        await db.insert(emailEvents).values({
          teamId: resolved.teamId,
          sequenceId: resolved.sequenceId,
          contactId: resolved.contactId,
          emailId: resolved.emailId,
          action: EmailEventAction.CLICK,
          link: destination,
          linkIndex: payload.index as number | undefined,
        });
        captureEvent({
          event: "email_link_clicked",
          source: "tracking.click",
          teamId: resolved.teamId,
          properties: {
            sequence_id: resolved.sequenceId,
            email_id: resolved.emailId,
            link_index: payload.index,
          },
        });
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to record click event");
    captureError({
      error: err,
      source: "tracking.click",
      context: { route: "/track/click" },
    });
  }

  res.redirect(destination);
});

// Unsubscribe links. A GET never changes anything: link scanners and mail
// clients prefetch every URL in an email, so the GET only renders a
// confirmation page. The unsubscribe happens on POST, which serves both that
// page's form (`source=page`) and RFC 8058 one-click requests sent by mailbox
// providers (`List-Unsubscribe=One-Click`), which only need a 2xx.
router.get("/unsubscribe/:unsubscribeToken", async (req: Request, res: Response) => {
  if (req.params.unsubscribeToken === TEST_UNSUBSCRIBE_TOKEN) {
    return res.type("html").send(testUnsubscribePage());
  }
  try {
    const contact = await getContactByUnsubscribeToken(req.params.unsubscribeToken);
    if (!contact) {
      return res.status(404).type("html").send(invalidUnsubscribeLinkPage());
    }

    res
      .type("html")
      .send(
        contact.subscribed
          ? unsubscribeConfirmPage(contact.email)
          : unsubscribedPage(contact.email),
      );
  } catch (err: any) {
    handleUnsubscribeError(err, res);
  }
});

router.post("/unsubscribe/:unsubscribeToken", async (req: Request, res: Response) => {
  if (req.params.unsubscribeToken === TEST_UNSUBSCRIBE_TOKEN) {
    return req.body?.source === "page"
      ? res.type("html").send(testUnsubscribePage())
      : res.status(200).end();
  }
  try {
    const contact = await getContactByUnsubscribeToken(req.params.unsubscribeToken);
    if (!contact) {
      return res.status(404).type("html").send(invalidUnsubscribeLinkPage());
    }

    if (contact.subscribed) {
      await updateContact(contact.teamId, contact.contactId, {
        subscribed: false,
      });
      captureEvent({
        event: "contact_unsubscribed",
        source: "tracking.unsubscribe",
        teamId: contact.teamId,
        properties: {
          method: req.body?.source === "page" ? "page" : "one_click",
        },
      });
    }

    if (req.body?.source === "page") {
      return res.type("html").send(unsubscribedPage(contact.email));
    }
    res.status(200).end();
  } catch (err: any) {
    handleUnsubscribeError(err, res);
  }
});

function handleUnsubscribeError(err: any, res: Response) {
  logger.error({ error: err.message }, "Failed to process unsubscribe");
  captureError({
    error: err,
    source: "tracking.unsubscribe",
    context: { route: "/unsubscribe/:unsubscribeToken" },
  });
  res.status(500).send("Something went wrong. Please try again.");
}

/** Resolves the public ids decoded from a tracking JWT into the internal ids
 * `email_events` now requires as FKs. Fails soft (returns `null`) if the
 * contact/sequence/email was deleted since send — the caller already treats
 * that the same way a DB error would be treated (log and move on, never 500
 * a tracking pixel/redirect request). */
async function resolveEventIds(payload: TeamScopedEvent): Promise<{
  teamId: string;
  sequenceId: string;
  contactId: string;
  emailId: string;
} | null> {
  const contact = await getContactByContactId(payload.contactId);
  if (!contact) return null;

  const sequence = await getSequenceRowBySequenceId(contact.teamId, payload.sequenceId);
  if (!sequence) return null;

  const email = await getSequenceEmailByEmailId(sequence.id, payload.emailId);
  if (!email) return null;

  return {
    teamId: contact.teamId,
    sequenceId: sequence.id,
    contactId: contact.id,
    emailId: email.id,
  };
}

export default router;
