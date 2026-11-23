import { z } from "zod";

export const deliveryEventType = [
  "accepted",
  "delivered",
  "delayed",
  "soft_bounce",
  "hard_bounce",
  "failed",
  "complaint",
  "suppressed",
  "rejected",
  "unknown",
] as const;

export const bounceClass = ["permanent", "transient", "undetermined"] as const;

export const deliverySourceTypes = ["organization", "team"] as const;

/** One immutable canonical event, normalized from a provider webhook — see
 * `docs/bounces-and-complaints.md#5-canonical-delivery-events`. */
export const deliveryEventSchema = z.object({
  eventId: z.string(),
  provider: z.string(),
  espId: z.string().nullable(),
  deliverySourceType: z.enum(deliverySourceTypes).nullable(),
  /** Public `msg_...` id of the correlated outbound message, when the
   * event was matched to one — see the PRD's correlation section. */
  messageId: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  eventType: z.enum(deliveryEventType),
  bounceClass: z.enum(bounceClass).nullable().optional(),
  smtpCode: z.number().nullable().optional(),
  enhancedStatusCode: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  occurredAt: z.string(),
  receivedAt: z.string(),
});

export const listDeliveryEventsQuerySchema = z.object({
  espId: z.string().optional(),
  deliverySourceType: z.enum(deliverySourceTypes).optional(),
  eventType: z.enum(deliveryEventType).optional(),
  createdAfter: z.coerce.number().int().optional(),
  createdBefore: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().min(1).optional(),
  itemsPerPage: z.coerce.number().int().min(1).optional(),
});

/** What happened to one sent email, from the outbound message ledger:
 * `complained` when the recipient marked it as spam (even if it was
 * delivered), else `bounced`, `delivered`, `failed`, or `sent` when the ESP
 * accepted it and hasn't reported back yet. */
export const deliveryOutcome = [
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;
export type DeliveryOutcome = (typeof deliveryOutcome)[number];
