import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { emailEvents } from "../db/schema";
import { verifyPixelToken } from "../utils/pixel-jwt";
import {
  getContactByContactId,
  getContactByUnsubscribeToken,
  updateContact,
} from "../contacts/queries";
import { EmailEventAction } from "../config/constants";
import logger from "../services/log";

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
}

// Open-tracking pixel embedded in outgoing mail.
router.get("/track/open", async (req: Request, res: Response) => {
  const token = String(req.query.d || "");
  const payload = verifyPixelToken<TeamScopedEvent>(token);

  res.set("Content-Type", "image/gif");
  res.send(TRANSPARENT_GIF);

  if (!payload) return;
  try {
    await db.insert(emailEvents).values({
      teamId: (await findTeamIdForContact(payload.contactId)) || "",
      sequenceId: payload.sequenceId,
      contactId: payload.contactId,
      emailId: payload.emailId,
      action: EmailEventAction.OPEN,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to record open event");
  }
});

// Click-tracking redirect embedded in outgoing mail links.
router.get("/track/click", async (req: Request, res: Response) => {
  const token = String(req.query.d || "");
  const payload = verifyPixelToken<TeamScopedEvent>(token);
  if (!payload || !payload.link) {
    return res.status(400).send("Invalid tracking link");
  }

  const destination = decodeURIComponent(payload.link);

  try {
    await db.insert(emailEvents).values({
      teamId: (await findTeamIdForContact(payload.contactId)) || "",
      sequenceId: payload.sequenceId,
      contactId: payload.contactId,
      emailId: payload.emailId,
      action: EmailEventAction.CLICK,
      link: destination,
      linkIndex: payload.index,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to record click event");
  }

  res.redirect(destination);
});

// Unsubscribe a contact via their unsubscribe link.
router.get(
  "/unsubscribe/:unsubscribeToken",
  async (req: Request, res: Response) => {
    const contact = await getContactByUnsubscribeToken(
      req.params.unsubscribeToken,
    );
    if (!contact) return res.status(404).send("Invalid unsubscribe link");

    await updateContact(contact.teamId, contact.contactId, {
      subscribedToUpdates: false,
    });

    res
      .type("html")
      .send(
        "<!DOCTYPE html><html><body>You have been unsubscribed.</body></html>",
      );
  },
);

async function findTeamIdForContact(contactId: string): Promise<string | null> {
  const contact = await getContactByContactId(contactId);
  return contact?.teamId ?? null;
}

export default router;
