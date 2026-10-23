import { and, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { TEST_CONTACT_ID, TEST_UNSUBSCRIBE_TOKEN } from "../config/constants";
import { getContactByContactId } from "../contacts/queries";
import { db } from "../db/client";
import { sequenceEmails, sequences } from "../db/schema";
import { renderCampaignHtml, verifyCampaignViewToken } from "../mail/campaign";
import { captureError } from "../observability";
import { getContentVersion } from "../sequences/content-versions";
import logger from "../services/log";
import { getTeam } from "../team/queries";
import { emailUnavailablePage } from "./unsubscribe-page";

const router = Router();

/** Email HTML is team-authored, so the web version runs as a sandboxed,
 * script-free document: it can't read this origin's cookies or storage, and
 * a link still opens when the reader clicks it. */
const WEB_VIEW_CSP = [
  "sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
  "default-src 'none'",
  "img-src * data:",
  "style-src 'unsafe-inline' *",
  "font-src * data:",
].join("; ");

// The hosted "view in browser" version of one broadcast or sequence email,
// personalised for the recipient the signed link was sent to. Links carry the
// version that was sent, so later edits don't change them; older links
// without one show the current content.
router.get("/view/:token", async (req: Request, res: Response) => {
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Referrer-Policy", "no-referrer");
  const ids = verifyCampaignViewToken(req.params.token);
  if (!ids) {
    return res.status(404).type("html").send(emailUnavailablePage());
  }
  try {
    const [sequence] = await db
      .select()
      .from(sequences)
      .where(eq(sequences.sequenceId, ids.sequenceId))
      .limit(1);
    const [email] = sequence
      ? await db
          .select()
          .from(sequenceEmails)
          .where(
            and(
              eq(sequenceEmails.sequenceId, sequence.id),
              eq(sequenceEmails.emailId, ids.emailId),
            ),
          )
          .limit(1)
      : [];
    const team = sequence ? await getTeam(sequence.teamId) : null;
    // A test send's link carries a contact id that matches nobody; it shows
    // the email without anyone's data.
    const isTest = ids.contactId === TEST_CONTACT_ID;
    const contact = isTest ? null : await getContactByContactId(ids.contactId);
    if (
      !sequence ||
      !email ||
      !team ||
      (!isTest && (!contact || contact.teamId !== sequence.teamId))
    ) {
      return res.status(404).type("html").send(emailUnavailablePage());
    }
    const version = ids.versionId
      ? await getContentVersion(email.id, ids.versionId)
      : null;
    if (ids.versionId && !version) {
      return res.status(404).type("html").send(emailUnavailablePage());
    }

    const html = await renderCampaignHtml({
      team,
      content: version ? version.content : email.content,
      subscriber: contact
        ? { email: contact.email, name: contact.name, tags: contact.tags }
        : { email: "", name: null, tags: [] },
      ids,
      unsubscribeToken: contact?.unsubscribeToken ?? TEST_UNSUBSCRIBE_TOKEN,
      web: true,
    });
    res.setHeader("Content-Security-Policy", WEB_VIEW_CSP);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type("html").send(html);
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to render web version");
    captureError({
      error: err,
      source: "tracking.web_view",
      context: { route: "/view/:token" },
    });
    res.status(500).send("Something went wrong. Please try again.");
  }
});

export default router;
