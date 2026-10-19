import { eq } from "drizzle-orm";
import { commitSendReservation, releaseSendReservation } from "../billing/entitlements";
import { sequenceBounceLimit } from "../config/constants";
import {
  addTagToContact,
  getContactById,
  removeTagFromContact,
} from "../contacts/queries";
import { db } from "../db/client";
import {
  emailDeliveries,
  ongoingSequences,
  sequenceEmails,
  sequences,
} from "../db/schema";
import { resolvePinnedDeliverySource } from "../delivery/queries";
import { commitQuotaForOutbound } from "../delivery/quota";
import { markOutboundAccepted } from "../delivery-feedback/outbound-queries";
import {
  createPinnedOutboundMessage,
  extractProviderMessageId,
  withCorrelationHeaders,
} from "../delivery-feedback/outbound-send";
import { isRecipientSuppressed } from "../delivery-feedback/suppression-queries";
import { renderCampaignHtml } from "../mail/campaign";
import { sendMail } from "../mail/send";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";
import { getTeam } from "../team/queries";
import { normalizeEmail } from "../utils/email";
import { getEmailFrom, getListUnsubscribeHeaders } from "../utils/mail";
import {
  claimOngoingSequence,
  countOngoingSequencesForSequence,
  deleteOngoingSequence,
  getSequenceRowById,
  markBroadcastSent,
  releaseOngoingSequenceClaim,
} from "./queries";

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
  const ongoingSequence = await claimOngoingSequence(ongoingSequenceId);
  if (!ongoingSequence) return;

  try {
    const sequenceRow = await getSequenceRowById(ongoingSequence.sequenceId);
    const contact = await getContactById(ongoingSequence.contactId);
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
      return cleanUpResources(
        ongoingSequence,
        true,
        sequenceRow.type,
        sequenceRow.sequenceId,
      );
    }

    await attemptMailSending({
      team,
      contact,
      sequence: sequenceRow,
      ongoingSequence,
      email: nextEmail,
    });

    const sentEmailIds = [...ongoingSequence.sentEmailIds, nextEmail.emailId];
    const followUpEmail = getNextPublishedEmail(sequenceRow.emailsOrder, emails, {
      ...ongoingSequence,
      sentEmailIds,
    });

    if (!followUpEmail) {
      await db
        .update(ongoingSequences)
        .set({ sentEmailIds, processingStartedAt: null })
        .where(eq(ongoingSequences.id, ongoingSequence.id));
      return cleanUpResources(
        {
          id: ongoingSequence.id,
          sequenceId: ongoingSequence.sequenceId,
          teamId: ongoingSequence.teamId,
        },
        true,
        sequenceRow.type,
        sequenceRow.sequenceId,
      );
    }

    await db
      .update(ongoingSequences)
      .set({
        sentEmailIds,
        nextEmailScheduledTime:
          ongoingSequence.nextEmailScheduledTime + followUpEmail.delayInMillis,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(ongoingSequences.id, ongoingSequence.id));
  } catch (err: any) {
    await releaseOngoingSequenceClaim(ongoingSequenceId);
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
  ongoingSequence: Pick<OngoingSequenceRow, "id" | "sequenceId"> &
    Partial<Pick<OngoingSequenceRow, "teamId">>,
  completed?: boolean,
  sequenceType?: string,
  /** Public `sequences.sequenceId`, required whenever `completed` is true. */
  publicSequenceId?: string,
) {
  await deleteOngoingSequence(ongoingSequence.id);
  // Only broadcasts (one-off, single audience snapshot) get marked "completed"
  // once every recipient has been delivered to. Multi-step "sequence" type
  // automations stay "active" indefinitely so future contacts can still be
  // enrolled by their trigger (see `automation/fire-event.ts`).
  // Zero-recipient broadcasts never create ongoing rows; they complete in
  // `processRule` instead (see automation/process-rules.ts).
  if (completed && sequenceType === "broadcast" && publicSequenceId) {
    const remaining = await countOngoingSequencesForSequence(
      ongoingSequence.sequenceId,
    );
    if (remaining === 0) {
      await markBroadcastSent(publicSequenceId);
      captureEvent({
        event: "broadcast_sent",
        source: "automation.process_ongoing_sequence",
        teamId: ongoingSequence.teamId,
        properties: { sequence_id: publicSequenceId },
      });
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
  contact: NonNullable<Awaited<ReturnType<typeof getContactById>>>;
  sequence: typeof sequences.$inferSelect;
  ongoingSequence: OngoingSequenceRow;
  email: SequenceEmailRow;
}) {
  if (!sequence.deliverySourceType || !sequence.outboxId) {
    throw new Error("Team ESP is not configured.");
  }
  const pin = await resolvePinnedDeliverySource({
    teamId: team.id,
    type: sequence.deliverySourceType as "organization" | "team",
    espConfigId: sequence.outboxId,
    espGrantId: sequence.espGrantId,
    purpose: "marketing",
  });
  const from = getEmailFrom({
    name: pin.fromName,
    email: pin.fromEmail,
  });
  const to = contact.email;
  const subject = email.subject;

  if (!email.content) return;

  // Recheck immediately before rendering/transport — closes the race
  // between scheduling and a bounce/complaint received in the meantime.
  // A suppressed recipient is treated as handled (advances the sequence,
  // like a normal send) but never counted as sent — see
  // docs/bounces-and-complaints.md#8-suppression-model.
  if (await isRecipientSuppressed(team.id, to)) {
    logger.info(
      { sequence_id: sequence.sequenceId, contactId: contact.contactId },
      "skipped suppressed recipient",
    );
    captureEvent({
      event: "email_send_suppressed",
      source: "automation.attempt_mail_sending",
      teamId: team.id,
      properties: {
        sequence_id: sequence.sequenceId,
        sequence_type: sequence.type,
      },
    });
    return;
  }

  // NOTE: these ids must stay **public** — they get embedded into the
  // outgoing email's tracking pixel/links. `ongoingSequence.sequenceId` is
  // the *internal* id; use `sequence.sequenceId` (public) instead.
  const contentWithTrackedLinks = await renderCampaignHtml({
    team,
    content: email.content,
    subscriber: {
      email: contact.email,
      name: contact.name,
      tags: contact.tags,
    },
    contactId: contact.contactId,
    unsubscribeToken: contact.unsubscribeToken,
    sequenceId: sequence.sequenceId,
    emailId: email.emailId,
  });

  let outboundForReservation: { id: string } | null = null;
  try {
    // Outbound ledger row must exist before transport submission — see
    // docs/bounces-and-complaints.md#1-outbound-message-ledger.
    const { outbound, rfcMessageId } = await createPinnedOutboundMessage({
      teamId: team.id,
      deliverySourceType: pin.type,
      espConfigId: pin.espConfigId,
      espGrantId: pin.espGrantId,
      provider: pin.provider,
      sourceType: "campaign",
      submissionKey: `campaign:${ongoingSequence.id}:${email.id}`,
      recipientEmail: to,
      normalizedRecipient: normalizeEmail(to),
      organizationQuotaGrantId: pin.type === "organization" ? pin.espGrantId : null,
    });
    outboundForReservation = outbound;
    // A transport may have succeeded immediately before the worker
    // crashed. The durable outbound ledger is then the source of truth:
    // finish the workflow action without submitting the same message a
    // second time.
    if (outbound.deliveryStatus === "accepted") {
      await applyEmailAction({ team, contact, sequence, email });
      return;
    }
    const result = await sendMail({
      purpose: "campaign",
      from,
      to,
      subject,
      html: contentWithTrackedLinks,
      headers: withCorrelationHeaders(
        outbound,
        getListUnsubscribeHeaders(contact.unsubscribeToken),
      ),
      teamId: team.id,
      espConfigId: pin.espConfigId,
      secretVersion: pin.secretVersion,
      messageId: rfcMessageId,
    });
    const [delivery] = await db
      .insert(emailDeliveries)
      .values({
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: contact.id,
        emailId: email.id,
      })
      .returning();
    await markOutboundAccepted(outbound.id, {
      providerMessageId: extractProviderMessageId(
        outbound.provider,
        result.providerResponse,
      ),
      campaignDeliveryId: delivery.id,
    });
    await commitQuotaForOutbound(outbound.id);
    await commitSendReservation(outbound.id);
    await applyEmailAction({ team, contact, sequence, email });
  } catch (err: any) {
    const retryCount = ongoingSequence.retryCount + 1;
    if (retryCount >= sequenceBounceLimit) {
      if (outboundForReservation) {
        await releaseSendReservation(outboundForReservation.id).catch(() => undefined);
      }
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
      // Keep the reservation through a transient retry. It expires and
      // is reopened atomically by reserveSend, preventing a retry from
      // bypassing the monthly quota.
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

/** Applies the email's on-send action (`tag:add` / `tag:remove`). The mail is
 * already delivered at this point, so a failure here is logged but never
 * bubbles up — otherwise the retry loop would send the email again. */
async function applyEmailAction({
  team,
  contact,
  sequence,
  email,
}: {
  team: NonNullable<Awaited<ReturnType<typeof getTeam>>>;
  contact: NonNullable<Awaited<ReturnType<typeof getContactById>>>;
  sequence: typeof sequences.$inferSelect;
  email: SequenceEmailRow;
}) {
  const tag = (email.actionData as { tag?: string } | null)?.tag;
  if (!email.actionType || !tag) return;

  try {
    if (email.actionType === "tag:add") {
      await addTagToContact(team.id, contact.contactId, tag);
    } else if (email.actionType === "tag:remove") {
      await removeTagFromContact(team.id, contact.contactId, tag);
    }
  } catch (err: any) {
    logger.error(
      {
        error: err.message,
        sequence_id: sequence.sequenceId,
        contactId: contact.contactId,
        actionType: email.actionType,
      },
      "applyEmailAction failed",
    );
    captureError({
      error: err,
      source: "automation.apply_email_action",
      teamId: team.id,
      context: {
        sequence_id: sequence.sequenceId,
        contact_id: contact.contactId,
        action_type: email.actionType,
      },
    });
  }
}
