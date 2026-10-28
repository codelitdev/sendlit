import { and, eq } from "drizzle-orm";
import { assertEmailContentAllowed } from "../abuse/content-scan";
import {
  EventType,
  TEST_CONTACT_ID,
  TEST_UNSUBSCRIBE_TOKEN,
} from "../config/constants";
import { findContactByEmail } from "../contacts/queries";
import { getEventSample } from "../events/queries";
import { db } from "../db/client";
import { sequenceEmails, sequences } from "../db/schema";
import {
  type DeliverySourceSelection,
  resolveDeliverySource,
  resolvePinnedDeliverySource,
} from "../delivery/queries";
import {
  chargeOrganizationQuotaForTests,
  refundOrganizationQuotaForTests,
  type TestQuotaCharge,
} from "../delivery/quota";
import { isRecipientSuppressed } from "../delivery-feedback/suppression-queries";
import { renderCampaignHtml } from "../mail/campaign";
import { sendMail } from "../mail/send";
import { captureEvent } from "../observability";
import { withoutProviderTracking } from "../settings/esp/provider-capabilities";
import { assertMailingAddressConfigured } from "../settings/general/queries";
import { trackingOriginForTeam } from "../settings/tracking-domain/queries";
import { getTeam } from "../team/queries";
import { normalizeEmail } from "../utils/email";
import { getEmailFrom, getListUnsubscribeHeaders } from "../utils/mail";
import { getOrCreateContentVersion } from "./content-versions";
import { takeTestSendQuota } from "./test-send-limits";

/** A test goes to at most this many addresses (Mailchimp allows a handful). */
export const MAX_TEST_RECIPIENTS = 5;

export interface TestSendResult {
  sent: string[];
  skipped: { email: string; reason: "suppressed" }[];
  lastTestSentAt: string | null;
  /** Where `{{ event.* }}` came from, for an `event:custom` sequence. */
  eventSample?: "last_event" | "none";
}

/**
 * Sends one broadcast or sequence email to a few addresses, rendered exactly
 * like a real send (merge tags, footer, tracking) with a `[Test]` subject.
 * Merge tags use the recipient's contact data when they are a contact of the
 * team. Errors are thrown as codes: `sequence_not_found`, `email_not_found`,
 * `test_recipients_required`, `test_send_limit_reached` (team) and
 * `test_send_email_limit_reached` (this email), both `TestSendLimitError`s,
 * plus the delivery source, shared-mailbox quota and mailing address errors a
 * real send would raise. Tests through a shared mailbox count against the
 * team's shared-delivery quota; tests through the team's own ESP don't.
 */
export async function sendSequenceEmailTest({
  teamId,
  sequenceId,
  emailId,
  to,
  fallbackRecipient,
}: {
  teamId: string;
  /** Public `sequences.sequenceId`. */
  sequenceId: string;
  /** Public `sequence_emails.emailId`. */
  emailId: string;
  to?: string[];
  /** Used when `to` is empty: the signed-in user's own address. */
  fallbackRecipient?: string | null;
}): Promise<TestSendResult> {
  const [sequence] = await db
    .select()
    .from(sequences)
    .where(and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)))
    .limit(1);
  if (!sequence) throw new Error("sequence_not_found");
  const [email] = await db
    .select()
    .from(sequenceEmails)
    .where(
      and(
        eq(sequenceEmails.sequenceId, sequence.id),
        eq(sequenceEmails.emailId, emailId),
      ),
    )
    .limit(1);
  if (!email) throw new Error("email_not_found");
  const team = await getTeam(teamId);
  if (!team) throw new Error("sequence_not_found");

  // A test is a real send, so it passes the same hosted content checks.
  await assertEmailContentAllowed({ teamId, email });

  const requested = to?.length ? to : fallbackRecipient ? [fallbackRecipient] : [];
  const recipients = [...new Set(requested.map(normalizeEmail))];
  if (recipients.length === 0) throw new Error("test_recipients_required");
  if (recipients.length > MAX_TEST_RECIPIENTS)
    throw new Error("too_many_test_recipients");
  // The footer needs the team's mailing address, as a real send does; say so
  // instead of failing inside the renderer.
  await assertMailingAddressConfigured(teamId);

  // Same source the real send uses: the pin once started, otherwise what
  // starting it now would resolve.
  const pin =
    sequence.deliverySourceType && sequence.outboxId
      ? await resolvePinnedDeliverySource({
          teamId,
          type: sequence.deliverySourceType as "organization" | "team",
          espConfigId: sequence.outboxId,
          espGrantId: sequence.espGrantId,
          purpose: "marketing",
        })
      : await resolveDeliverySource(
          teamId,
          (sequence.deliverySourceIntent as DeliverySourceSelection | null) ??
            undefined,
          "marketing",
        );

  const result: TestSendResult = { sent: [], skipped: [], lastTestSentAt: null };
  // An event-triggered sequence renders `{{ event.* }}` from the last payload
  // received for its event (docs/custom_events.md#merge-tags-event-prop).
  const eventTriggered =
    sequence.type === "sequence" &&
    sequence.triggerType === EventType.CUSTOM_EVENT &&
    !!sequence.triggerData;
  const sampleEvent = eventTriggered
    ? await getEventSample(teamId, sequence.triggerData!)
    : null;
  if (eventTriggered) result.eventSample = sampleEvent ? "last_event" : "none";
  const deliverable: string[] = [];
  for (const recipient of recipients) {
    if (await isRecipientSuppressed(teamId, recipient)) {
      result.skipped.push({ email: recipient, reason: "suppressed" });
    } else {
      deliverable.push(recipient);
    }
  }
  // The organization pays for its shared mailbox, so tests through it also
  // use the team's shared-delivery quota, like real sends.
  let charge: TestQuotaCharge | null = null;
  try {
    await takeTestSendQuota({
      teamId,
      emailId: email.emailId,
      recipients: deliverable.length,
    });
    if (pin.type === "organization" && pin.espGrantId && deliverable.length > 0) {
      charge = await chargeOrganizationQuotaForTests({
        grantId: pin.espGrantId,
        count: deliverable.length,
      });
    }
  } catch (error) {
    if (error instanceof Error && /limit_reached|quota_exhausted/.test(error.message)) {
      captureEvent({
        event: "sequence_email_test_limited",
        source: "sequences.test_send",
        teamId,
        properties: {
          sequence_id: sequence.sequenceId,
          email_id: email.emailId,
          error_code: error.message,
          kind: pin.type,
          recipients_count: deliverable.length,
        },
      });
    }
    throw error;
  }

  try {
    // The test's "view in browser" link shows this copy, not later edits.
    const contentVersion =
      deliverable.length > 0
        ? await getOrCreateContentVersion({ ...email, teamId })
        : null;
    for (const recipient of deliverable) {
      const contact = await findContactByEmail(teamId, recipient);
      const html = await renderCampaignHtml({
        team,
        content: email.content,
        subscriber: {
          email: recipient,
          name: contact?.name ?? null,
          tags: contact?.tags ?? [],
        },
        ids: {
          contactId: TEST_CONTACT_ID,
          sequenceId: sequence.sequenceId,
          emailId: email.emailId,
        },
        contentVersionId: contentVersion?.versionId,
        unsubscribeToken: TEST_UNSUBSCRIBE_TOKEN,
        viewInBrowser: sequence.viewInBrowser,
        event: sampleEvent,
      });
      await sendMail({
        purpose: "campaign",
        from: getEmailFrom({ name: pin.fromName, email: pin.fromEmail }),
        to: recipient,
        subject: `[Test] ${email.subject}`,
        html,
        replyTo: pin.replyTo,
        headers: withoutProviderTracking(
          pin.provider,
          getListUnsubscribeHeaders(
            TEST_UNSUBSCRIBE_TOKEN,
            await trackingOriginForTeam(teamId),
          ),
          { opens: true, clicks: true },
        ),
        teamId,
        espConfigId: pin.espConfigId,
        secretVersion: pin.secretVersion,
      });
      result.sent.push(recipient);
    }
  } catch (error) {
    if (charge) {
      await refundOrganizationQuotaForTests(
        charge,
        deliverable.length - result.sent.length,
      );
    }
    throw error;
  }

  if (result.sent.length > 0) {
    const now = new Date();
    await db
      .update(sequenceEmails)
      .set({ lastTestSentAt: now })
      .where(eq(sequenceEmails.id, email.id));
    result.lastTestSentAt = now.toISOString();
    captureEvent({
      event: "sequence_email_test_sent",
      source: "sequences.test_send",
      teamId,
      properties: {
        sequence_id: sequence.sequenceId,
        sequence_type: sequence.type,
        recipients_count: result.sent.length,
      },
    });
  } else {
    result.lastTestSentAt = email.lastTestSentAt?.toISOString() ?? null;
  }
  return result;
}
