import { and, eq } from "drizzle-orm";
import { assertEmailContentAllowed } from "../abuse/content-scan";
import { TEST_CONTACT_ID, TEST_UNSUBSCRIBE_TOKEN } from "../config/constants";
import { findContactByEmail } from "../contacts/queries";
import { db } from "../db/client";
import { sequenceEmails, sequences } from "../db/schema";
import {
  type DeliverySourceSelection,
  resolveDeliverySource,
  resolvePinnedDeliverySource,
} from "../delivery/queries";
import { isRecipientSuppressed } from "../delivery-feedback/suppression-queries";
import { renderCampaignHtml } from "../mail/campaign";
import { sendMail } from "../mail/send";
import { captureEvent } from "../observability";
import { getTeam } from "../team/queries";
import { normalizeEmail } from "../utils/email";
import { getEmailFrom, getListUnsubscribeHeaders } from "../utils/mail";

/** A test goes to at most this many addresses (Mailchimp allows a handful). */
export const MAX_TEST_RECIPIENTS = 5;
/** Test recipients per team per hour, across REST and MCP. Test sends skip
 * billing and the outbound ledger, so this keeps them from becoming a free
 * bulk-send path. */
export const TEST_RECIPIENTS_PER_HOUR = 50;

const testSendLog = new Map<string, number[]>();

function takeTestQuota(teamId: string, recipients: number) {
  const now = Date.now();
  const recent = (testSendLog.get(teamId) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length + recipients > TEST_RECIPIENTS_PER_HOUR) {
    testSendLog.set(teamId, recent);
    throw new Error("test_send_limit_reached");
  }
  testSendLog.set(teamId, [...recent, ...Array(recipients).fill(now)]);
}

export interface TestSendResult {
  sent: string[];
  skipped: { email: string; reason: "suppressed" }[];
  lastTestSentAt: string | null;
}

/**
 * Sends one broadcast or sequence email to a few addresses, rendered exactly
 * like a real send (merge tags, footer, tracking) with a `[Test]` subject.
 * Merge tags use the recipient's contact data when they are a contact of the
 * team. Errors are thrown as codes: `sequence_not_found`, `email_not_found`,
 * `test_recipients_required`, `test_send_limit_reached`, plus the delivery
 * source and mailing address errors a real send would raise.
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
  const deliverable: string[] = [];
  for (const recipient of recipients) {
    if (await isRecipientSuppressed(teamId, recipient)) {
      result.skipped.push({ email: recipient, reason: "suppressed" });
    } else {
      deliverable.push(recipient);
    }
  }
  takeTestQuota(teamId, deliverable.length);

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
      unsubscribeToken: TEST_UNSUBSCRIBE_TOKEN,
    });
    await sendMail({
      purpose: "campaign",
      from: getEmailFrom({ name: pin.fromName, email: pin.fromEmail }),
      to: recipient,
      subject: `[Test] ${email.subject}`,
      html,
      replyTo: pin.replyTo,
      headers: getListUnsubscribeHeaders(TEST_UNSUBSCRIBE_TOKEN),
      teamId,
      espConfigId: pin.espConfigId,
      secretVersion: pin.secretVersion,
    });
    result.sent.push(recipient);
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
