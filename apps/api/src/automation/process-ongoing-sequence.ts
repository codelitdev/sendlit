import { eq } from "drizzle-orm";
import { type Email as EmailType } from "@sendlit/email-editor";
import { db } from "../db/client";
import {
    emailDeliveries,
    ongoingSequences,
    sequenceEmails,
    sequences,
} from "../db/schema";
import { getTeam } from "../team/queries";
import {
    getAccount,
    hasMailQuotaRemaining,
    incrementMailCount,
} from "../account/queries";
import { getEspConfig, getEspConfigById } from "../settings/esp/queries";
import { getGeneralSettings } from "../settings/general/queries";
import {
    addTagToContact,
    getContactById,
    removeTagFromContact,
} from "../contacts/queries";
import { sendMail } from "../mail/send";
import {
    appendTrackingPixel,
    renderEmailContent,
    transformLinksForClickTracking,
} from "../mail/render";
import { getEmailFrom, getSiteUrl, getUnsubLink } from "../utils/mail";
import { generatePixelToken } from "../utils/pixel-jwt";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import {
    countOngoingSequencesForSequence,
    deleteOngoingSequence,
    getSequenceRowById,
    markBroadcastSent,
} from "./queries";
import { sequenceBounceLimit } from "../config/constants";

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

    // A stale/duplicate job (or a concurrent worker) may arrive after another
    // run already sent this tick's email and advanced the schedule. Without
    // this guard the next email would go out immediately, skipping its delay.
    if (ongoingSequence.nextEmailScheduledTime > Date.now()) return;

    try {
        const sequenceRow = await getSequenceRowById(
            ongoingSequence.sequenceId,
        );
        const contact = await getContactById(ongoingSequence.contactId);
        const team = await getTeam(ongoingSequence.teamId);

        if (!sequenceRow || !contact || !team) {
            return cleanUpResources(ongoingSequence);
        }

        // Quota is account-level, shared across all teams the account owns.
        const hasQuota = await hasMailQuotaRemaining(team.ownerAccountId);
        if (!hasQuota) {
            logger.warn(
                { teamId: ongoingSequence.teamId },
                "Mail quota exceeded, skipping ongoing sequence tick",
            );
            captureEvent({
                event: "mail_quota_exceeded",
                source: "automation.process_ongoing_sequence",
                teamId: ongoingSequence.teamId,
                properties: {
                    ongoing_sequence_id: ongoingSequence.id,
                },
            });
            return;
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

        const sentEmailIds = [
            ...ongoingSequence.sentEmailIds,
            nextEmail.emailId,
        ];
        await incrementMailCount(team.ownerAccountId);

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
                    ongoingSequence.nextEmailScheduledTime +
                    followUpEmail.delayInMillis,
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
    // Sender identity fallback chain: the sequence's pinned outbox (an
    // esp_configs row via `sequences.outboxId`) → the team's esp config →
    // team name / owner account email.
    const outbox =
        (sequence.outboxId
            ? await getEspConfigById(sequence.outboxId)
            : null) ?? (await getEspConfig(team.id));
    const ownerAccount = await getAccount(team.ownerAccountId);
    const from = getEmailFrom({
        name: outbox?.fromName || team.name,
        email:
            outbox?.fromEmail ||
            ownerAccount?.email ||
            process.env.EMAIL_FROM ||
            "",
    });
    const to = contact.email;
    const subject = email.subject;
    const unsubscribeLink = getUnsubLink(contact.unsubscribeToken);
    const generalSettings = await getGeneralSettings(team.id);
    const templatePayload = {
        subscriber: {
            email: contact.email,
            name: contact.name,
            tags: contact.tags,
        },
        address: generalSettings.mailingAddress || "",
        unsubscribe_link: unsubscribeLink,
    };

    if (!email.content) return;

    // NOTE: these three must stay **public** ids — they get embedded into the
    // outgoing email's tracking pixel/links, and `tracking/routes.ts` only
    // has the decoded token (no other context) to resolve them from, days
    // later. `ongoingSequence.sequenceId` is the *internal* id at the DB
    // layer after the FK normalization — use `sequence.sequenceId` (public)
    // instead.
    const pixelToken = generatePixelToken({
        contactId: contact.contactId,
        sequenceId: sequence.sequenceId,
        emailId: email.emailId,
    });
    const pixelUrl = `${getSiteUrl()}/api/track/open?d=${pixelToken}`;
    const content = email.content as EmailType;
    const emailContentWithPixel = appendTrackingPixel(content, pixelUrl);

    const renderedHtml = await renderEmailContent({
        content: emailContentWithPixel,
        variables: templatePayload,
    });

    const contentWithTrackedLinks = transformLinksForClickTracking(
        renderedHtml,
        (originalUrl, index) => {
            const linkToken = generatePixelToken({
                contactId: contact.contactId,
                sequenceId: sequence.sequenceId,
                emailId: email.emailId,
                index,
                link: encodeURIComponent(originalUrl),
            });
            return `${getSiteUrl()}/api/track/click?d=${linkToken}`;
        },
        { sequence_id: sequence.sequenceId, email_id: email.emailId },
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
            sequenceId: sequence.id,
            contactId: contact.id,
            emailId: email.id,
        });
        await applyEmailAction({ team, contact, sequence, email });
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
                                ...((sequence.report as any)?.sequence
                                    ?.failed || []),
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
