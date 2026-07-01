import { Liquid } from "liquidjs";
import { JSDOM } from "jsdom";
import { eq } from "drizzle-orm";
import {
  renderEmailToHtml,
  type Email as EmailType,
} from "@sendlit/email-editor";
import { db } from "../db/client";
import {
  emailDeliveries,
  ongoingSequences,
  sequenceEmails,
  sequences,
} from "../db/schema";
import {
  getTeam,
  hasMailQuotaRemaining,
  incrementMailCount,
} from "../team/queries";
import { getContactByContactId } from "../contacts/queries";
import { sendMail } from "../mail/send";
import { getEmailFrom, getSiteUrl, getUnsubLink } from "../utils/mail";
import { generatePixelToken } from "../utils/pixel-jwt";
import logger from "../services/log";
import {
  countOngoingSequencesForSequence,
  deleteOngoingSequence,
  getSequenceRowBySequenceId,
  markBroadcastSent,
} from "./queries";
import { sequenceBounceLimit } from "../config/constants";

const liquidEngine = new Liquid();

type OngoingSequenceRow = typeof ongoingSequences.$inferSelect;
type SequenceEmailRow = typeof sequenceEmails.$inferSelect;

/**
 * Ported from `courselit/apps/queue/src/domain/process-ongoing-sequences/process-ongoing-sequence.ts`.
 * This is the actual send loop for both broadcasts and sequences: it figures
 * out the next unpublished/undelivered email, renders it (liquid merge tags +
 * open pixel + click-tracked links), sends it, records the delivery, and
 * schedules the following email (or cleans up once the sequence is done).
 */
export async function processOngoingSequence(ongoingSequenceId: string) {
  const [ongoingSequence] = await db
    .select()
    .from(ongoingSequences)
    .where(eq(ongoingSequences.id, ongoingSequenceId))
    .limit(1);
  if (!ongoingSequence) return;

  try {
    const hasQuota = await hasMailQuotaRemaining(ongoingSequence.teamId);
    if (!hasQuota) {
      logger.warn(
        { teamId: ongoingSequence.teamId },
        "Mail quota exceeded, skipping ongoing sequence tick",
      );
      return;
    }

    const sequenceRow = await getSequenceRowBySequenceId(
      ongoingSequence.teamId,
      ongoingSequence.sequenceId,
    );
    const contact = await getContactByContactId(ongoingSequence.contactId);
    const team = await getTeam(ongoingSequence.teamId);

    if (!sequenceRow || !contact || !team) {
      return cleanUpResources(ongoingSequence);
    }

    const emails = await db
      .select()
      .from(sequenceEmails)
      .where(eq(sequenceEmails.sequenceId, sequenceRow.id));

    const nextEmail = getNextPublishedEmail(
      sequenceRow.emailsOrder,
      emails,
      ongoingSequence,
    );
    if (!nextEmail) {
      return cleanUpResources(ongoingSequence, true, sequenceRow.type);
    }

    await attemptMailSending({
      team,
      contact,
      sequence: sequenceRow,
      ongoingSequence,
      email: nextEmail,
    });

    const sentEmailIds = [...ongoingSequence.sentEmailIds, nextEmail.emailId];
    await incrementMailCount(ongoingSequence.teamId);

    const followUpEmail = getNextPublishedEmail(
      sequenceRow.emailsOrder,
      emails,
      { ...ongoingSequence, sentEmailIds },
    );

    if (!followUpEmail) {
      await db
        .update(ongoingSequences)
        .set({ sentEmailIds })
        .where(eq(ongoingSequences.id, ongoingSequence.id));
      return cleanUpResources(
        { id: ongoingSequence.id, sequenceId: ongoingSequence.sequenceId },
        true,
        sequenceRow.type,
      );
    }

    await db
      .update(ongoingSequences)
      .set({
        sentEmailIds,
        nextEmailScheduledTime:
          ongoingSequence.nextEmailScheduledTime + followUpEmail.delayInMillis,
        updatedAt: new Date(),
      })
      .where(eq(ongoingSequences.id, ongoingSequence.id));
  } catch (err: any) {
    logger.error(
      { error: err.message, ongoing_sequence_id: ongoingSequenceId },
      "processOngoingSequence failed",
    );
    throw err;
  }
}

export function getNextPublishedEmail(
  emailsOrder: string[],
  emails: SequenceEmailRow[],
  ongoingSequence: Pick<OngoingSequenceRow, "sentEmailIds">,
): SequenceEmailRow | null {
  const sentEmailIdsSet = new Set(ongoingSequence.sentEmailIds);
  for (const emailId of emailsOrder) {
    const email = emails.find((e) => e.emailId === emailId && e.published);
    if (email && !sentEmailIdsSet.has(email.emailId)) {
      return email;
    }
  }
  return null;
}

async function cleanUpResources(
  ongoingSequence: Pick<OngoingSequenceRow, "id" | "sequenceId">,
  completed?: boolean,
  sequenceType?: string,
) {
  await deleteOngoingSequence(ongoingSequence.id);
  // Only broadcasts (one-off, single audience snapshot) get marked "completed"
  // once every recipient has been delivered to. Multi-step "sequence" type
  // automations stay "active" indefinitely so future contacts can still be
  // enrolled by their trigger (see `automation/fire-event.ts`).
  if (completed && sequenceType === "broadcast") {
    const remaining = await countOngoingSequencesForSequence(
      ongoingSequence.sequenceId,
    );
    if (remaining === 0) {
      await markBroadcastSent(ongoingSequence.sequenceId);
    }
  }
}

async function attemptMailSending({
  team,
  contact,
  sequence,
  ongoingSequence,
  email,
}: {
  team: NonNullable<Awaited<ReturnType<typeof getTeam>>>;
  contact: NonNullable<Awaited<ReturnType<typeof getContactByContactId>>>;
  sequence: typeof sequences.$inferSelect;
  ongoingSequence: OngoingSequenceRow;
  email: SequenceEmailRow;
}) {
  const from = getEmailFrom({
    name: sequence.fromName || team.fromName || team.name,
    email: sequence.fromEmail || team.fromEmail || process.env.EMAIL_FROM || "",
  });
  const to = contact.email;
  const subject = email.subject;
  const unsubscribeLink = getUnsubLink(contact.unsubscribeToken);
  const templatePayload = {
    subscriber: {
      email: contact.email,
      name: contact.name,
      tags: contact.tags,
    },
    address: team.mailingAddress || "",
    unsubscribe_link: unsubscribeLink,
  };

  if (!email.content) return;

  const pixelToken = generatePixelToken({
    contactId: contact.contactId,
    sequenceId: ongoingSequence.sequenceId,
    emailId: email.emailId,
  });
  const pixelUrl = `${getSiteUrl()}/api/track/open?d=${pixelToken}`;
  const content = email.content as EmailType;
  const emailContentWithPixel: EmailType = {
    ...content,
    content: [
      ...content.content,
      {
        blockType: "image",
        settings: { src: pixelUrl, width: "1px", height: "1px", alt: "" },
      },
    ],
  };

  const renderedHtml = await liquidEngine.parseAndRender(
    await renderEmailToHtml({ email: emailContentWithPixel }),
    templatePayload,
  );

  const contentWithTrackedLinks = transformLinksForClickTracking(
    renderedHtml,
    contact.contactId,
    ongoingSequence.sequenceId,
    email.emailId,
  );

  try {
    await sendMail({
      from,
      to,
      subject,
      html: contentWithTrackedLinks,
      teamId: team.id,
    });
    await db.insert(emailDeliveries).values({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      contactId: contact.contactId,
      emailId: email.emailId,
    });
  } catch (err: any) {
    const retryCount = ongoingSequence.retryCount + 1;
    if (retryCount >= sequenceBounceLimit) {
      await db
        .update(sequences)
        .set({
          report: {
            ...(sequence.report as any),
            sequence: {
              ...(sequence.report as any)?.sequence,
              failed: [
                ...((sequence.report as any)?.sequence?.failed || []),
                contact.contactId,
              ],
            },
          },
        })
        .where(eq(sequences.id, sequence.id));
      await deleteOngoingSequence(ongoingSequence.id);
    } else {
      await db
        .update(ongoingSequences)
        .set({ retryCount })
        .where(eq(ongoingSequences.id, ongoingSequence.id));
    }
    logger.error(
      {
        error: err.message,
        sequence_id: sequence.sequenceId,
        contactId: contact.contactId,
      },
      "attemptMailSending failed",
    );
    throw err;
  }
}

function transformLinksForClickTracking(
  htmlContent: string,
  contactId: string,
  sequenceId: string,
  emailId: string,
): string {
  try {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    const links = document.querySelectorAll("a");

    links.forEach((link, index) => {
      const originalUrl = link.getAttribute("href");
      if (!originalUrl) return;
      if (
        originalUrl.includes("/api/track") ||
        originalUrl.includes("/unsubscribe") ||
        originalUrl.startsWith("mailto:") ||
        originalUrl.startsWith("tel:") ||
        originalUrl.startsWith("#")
      ) {
        return;
      }

      const linkToken = generatePixelToken({
        contactId,
        sequenceId,
        emailId,
        index,
        link: encodeURIComponent(originalUrl),
      });
      link.setAttribute(
        "href",
        `${getSiteUrl()}/api/track/click?d=${linkToken}`,
      );
    });

    return dom.serialize();
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "transformLinksForClickTracking failed",
    );
    return htmlContent;
  }
}
