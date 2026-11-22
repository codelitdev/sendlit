import type {
  DeliveryOutcome,
  sequenceDeliveryOutcomeFilter,
  sequenceDeliverySchema,
} from "@sendlit/api-contract";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { itemsPerPage as defaultItemsPerPage } from "../config/constants";
import { db } from "../db/client";
import {
  contacts,
  emailDeliveries,
  emailDeliveryEvents,
  outboundMessages,
  sequenceEmails,
} from "../db/schema";
import { normalizeEmail } from "../utils/email";
import { getActiveSuppressions } from "./suppression-queries";

/** One send's outcome from its ledger projection: a complaint wins (the
 * email was delivered, then marked as spam), then the delivery status.
 * `accepted`/`delayed` mean the ESP took it and hasn't reported back. */
export function deliveryOutcome(
  deliveryStatus: string,
  feedbackStatus: string,
): DeliveryOutcome {
  if (feedbackStatus === "complained") return "complained";
  switch (deliveryStatus) {
    case "delivered":
    case "bounced":
    case "failed":
      return deliveryStatus;
    case "cancelled":
      return "failed";
    default:
      return "sent";
  }
}

/** Events that carry the details behind a bounce or a complaint. */
const BOUNCE_EVENT_TYPES = ["hard_bounce", "soft_bounce", "rejected"];
const COMPLAINT_EVENT_TYPE = "complaint";

/** Hard or soft from the provider's bounce class, else its event type. A
 * bounced send with no event was rejected inline by the mail server with a
 * permanent SMTP 5xx (`markOutboundBounced`), so it is hard. */
function bounceType(
  event: { eventType: string; bounceClass: string | null } | undefined,
): "hard" | "soft" | null {
  if (!event) return "hard";
  if (event.bounceClass === "permanent") return "hard";
  if (event.bounceClass === "transient") return "soft";
  if (event.eventType === "hard_bounce") return "hard";
  if (event.eventType === "soft_bounce") return "soft";
  return null;
}

type SequenceDelivery = z.infer<typeof sequenceDeliverySchema>;

/**
 * The sends of one sequence or broadcast (internal id) with their outcome,
 * most recent outcome first. Counts the same rows as `sequenceDeliveryRates`
 * (accepted sends on the outbound ledger), so `outcome` lists exactly the
 * sends behind the stats' bounce and complaint rates.
 */
export async function listSequenceDeliveries({
  teamId,
  sequenceId,
  outcome,
  offset = 1,
  rowsPerPage = defaultItemsPerPage,
}: {
  teamId: string;
  sequenceId: string;
  outcome?: (typeof sequenceDeliveryOutcomeFilter)[number];
  offset?: number;
  rowsPerPage?: number;
}): Promise<{ items: SequenceDelivery[]; total: number }> {
  const where = and(
    eq(emailDeliveries.teamId, teamId),
    eq(emailDeliveries.sequenceId, sequenceId),
    isNotNull(outboundMessages.acceptedAt),
    outcome === "bounced" ? eq(outboundMessages.deliveryStatus, "bounced") : undefined,
    outcome === "complained"
      ? eq(outboundMessages.feedbackStatus, "complained")
      : undefined,
  );
  const outcomeAt = sql<Date>`coalesce(${outboundMessages.complainedAt}, ${outboundMessages.bouncedAt}, ${outboundMessages.deliveredAt}, ${outboundMessages.acceptedAt})`;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: outboundMessages.id,
        messageId: outboundMessages.messageId,
        email: outboundMessages.recipientEmail,
        deliveryStatus: outboundMessages.deliveryStatus,
        feedbackStatus: outboundMessages.feedbackStatus,
        complainedAt: outboundMessages.complainedAt,
        bouncedAt: outboundMessages.bouncedAt,
        deliveredAt: outboundMessages.deliveredAt,
        acceptedAt: outboundMessages.acceptedAt,
        contactId: contacts.contactId,
        emailId: sequenceEmails.emailId,
      })
      .from(outboundMessages)
      .innerJoin(
        emailDeliveries,
        eq(emailDeliveries.id, outboundMessages.campaignDeliveryId),
      )
      .innerJoin(contacts, eq(contacts.id, emailDeliveries.contactId))
      .innerJoin(sequenceEmails, eq(sequenceEmails.id, emailDeliveries.emailId))
      .where(where)
      .orderBy(desc(outcomeAt), desc(outboundMessages.id))
      .limit(rowsPerPage)
      .offset((Math.max(offset, 1) - 1) * rowsPerPage),
    db
      .select({ value: count() })
      .from(outboundMessages)
      .innerJoin(
        emailDeliveries,
        eq(emailDeliveries.id, outboundMessages.campaignDeliveryId),
      )
      .innerJoin(contacts, eq(contacts.id, emailDeliveries.contactId))
      .where(where),
  ]);

  const [events, suppressions] = await Promise.all([
    rows.length
      ? db
          .select({
            outboundMessageId: emailDeliveryEvents.outboundMessageId,
            eventType: emailDeliveryEvents.eventType,
            bounceClass: emailDeliveryEvents.bounceClass,
            reason: emailDeliveryEvents.reason,
            smtpCode: emailDeliveryEvents.smtpCode,
            enhancedStatusCode: emailDeliveryEvents.enhancedStatusCode,
          })
          .from(emailDeliveryEvents)
          .where(
            and(
              eq(emailDeliveryEvents.teamId, teamId),
              inArray(
                emailDeliveryEvents.outboundMessageId,
                rows.map((row) => row.id),
              ),
              inArray(emailDeliveryEvents.eventType, [
                ...BOUNCE_EVENT_TYPES,
                COMPLAINT_EVENT_TYPE,
              ]),
            ),
          )
          .orderBy(desc(emailDeliveryEvents.occurredAt))
      : [],
    getActiveSuppressions(
      teamId,
      rows.map((row) => row.email),
    ),
  ]);

  // Newest first, so the first event seen per message and kind wins.
  const bounceEvents = new Map<string, (typeof events)[number]>();
  const complaintEvents = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (!event.outboundMessageId) continue;
    const byMessage =
      event.eventType === COMPLAINT_EVENT_TYPE ? complaintEvents : bounceEvents;
    if (!byMessage.has(event.outboundMessageId)) {
      byMessage.set(event.outboundMessageId, event);
    }
  }

  const items = rows.map((row): SequenceDelivery => {
    const result = deliveryOutcome(row.deliveryStatus, row.feedbackStatus);
    const bounce =
      row.deliveryStatus === "bounced" ? bounceEvents.get(row.id) : undefined;
    const detail =
      result === "complained"
        ? complaintEvents.get(row.id)
        : result === "bounced"
          ? bounce
          : undefined;
    const occurredAt =
      row.complainedAt ?? row.bouncedAt ?? row.deliveredAt ?? row.acceptedAt;
    return {
      messageId: row.messageId,
      contactId: row.contactId,
      email: row.email,
      emailId: row.emailId,
      outcome: result,
      bounceType: result === "bounced" ? bounceType(bounce) : null,
      reason: detail?.reason ?? null,
      smtpCode: detail?.smtpCode ?? null,
      enhancedStatusCode: detail?.enhancedStatusCode ?? null,
      occurredAt: occurredAt?.toISOString() ?? null,
      suppression: suppressions.get(normalizeEmail(row.email)) ?? null,
    };
  });

  return { items, total: Number(totalRow?.value ?? 0) };
}
