import {
  contactFilterSchema,
  sequenceEmailSchema as contractSequenceEmailSchema,
  sequenceSchema as contractSequenceSchema,
  customFieldsSchema,
  emailContentSchema,
} from "@sendlit/api-contract";
import { z } from "zod";

export { emailContentSchema };

export const contactSchema = z.object({
  contactId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  subscribed: z.boolean(),
  customFields: customFieldsSchema,
  tags: z.array(z.string()),
  unsubscribeToken: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const contactListSchema = z.object({
  items: z.array(contactSchema),
  total: z.number(),
});

export const segmentSchema = z.object({
  segmentId: z.string(),
  name: z.string(),
  filter: contactFilterSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const segmentListSchema = z.object({
  items: z.array(segmentSchema),
});

export const templateSchema = z.object({
  templateId: z.string().min(1),
  title: z.string(),
  purpose: z.enum(["marketing", "transactional"]),
  content: emailContentSchema,
  requiredVariables: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What the sequence tools return (`toPublicSequence` in tools/sequences.ts).
 * Built on the REST contract's schema, which is the source of truth, and
 * open to extra fields: a hand-kept copy here had drifted (it required an
 * `espId` the tools never return), so every sequence tool failed output
 * validation. */
export const sequenceSchema = contractSequenceSchema
  .extend({
    // MCP strips the source intent; REST callers get it.
    deliverySource: contractSequenceSchema.shape.deliverySource.optional(),
    emails: z.array(contractSequenceEmailSchema.passthrough()),
  })
  .passthrough();

export const sequenceListSchema = z.object({
  items: z.array(sequenceSchema),
  total: z.number(),
});

export const sequenceStatsSchema = z.object({
  sent: z.number(),
  openRate: z.number(),
  clickThroughRate: z.number(),
  subscribersCount: z.number(),
  bounceRate: z.number().optional(),
  complaintRate: z.number().optional(),
});

// ---- Bounce and complaint processing (docs/bounces-and-complaints.md) -----

const deliveryEventSchema = z.object({
  eventId: z.string(),
  provider: z.string(),
  espId: z.string().nullable(),
  deliverySourceType: z.enum(["organization", "team"]).nullable(),
  messageId: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  eventType: z.string(),
  bounceClass: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  occurredAt: z.string(),
  receivedAt: z.string(),
});

export const deliveryEventListSchema = z.object({
  items: z.array(deliveryEventSchema),
  total: z.number(),
});
