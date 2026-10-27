import { z } from "zod";
import { emailContentInputSchema, emailContentSchema } from "./common";
import { deliverySourceSelectionSchema } from "./delivery";

export const mailTypes = ["broadcast", "sequence"] as const;
export const sequenceStatus = ["draft", "active", "paused", "completed"] as const;
export const emailActionTypes = ["tag:add", "tag:remove"] as const;

export const sequenceEmailSchema = z.object({
  // NOTE: intentionally no `id`/`sequenceId` here — `sequence_emails.id` is
  // internal-only, and its `sequence_id` column holds the *parent*
  // sequence's internal id (see `db/schema.ts`), not a public identifier.
  emailId: z.string(),
  subject: z.string(),
  content: emailContentSchema,
  delayInMillis: z.number(),
  published: z.boolean(),
  templateId: z.string().nullable().optional(),
  // Plain string (see `contactSchema.lead`'s comment) — validated on write.
  actionType: z.string().nullable().optional(),
  actionData: z.record(z.any()).nullable().optional(),
  /** When a test of this email was last sent; `null` if never. */
  lastTestSentAt: z.string().nullable().optional(),
  /** Hosted content check: `clean`, `review` (held for SendLit's review),
   * `blocked`, or `approved` after review; `null` when not scanned. */
  contentScanVerdict: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const filterValueLabelSchema = z.object({
  valueLabel: z.string().optional(),
});

export const contactFilterConditionSchema = z.union([
  z
    .object({
      name: z.literal("email"),
      condition: z.enum(["is", "contains", "not_contains"]),
      value: z.string(),
    })
    .merge(filterValueLabelSchema),
  z
    .object({
      name: z.literal("tag"),
      condition: z.enum(["is", "is_not"]),
      value: z.string(),
    })
    .merge(filterValueLabelSchema),
  z
    .object({
      name: z.literal("subscription"),
      condition: z.literal("is"),
      value: z.enum(["subscribed", "unsubscribed"]),
    })
    .merge(filterValueLabelSchema),
  z
    .object({
      name: z.literal("signedUp"),
      condition: z.enum(["before", "after", "on"]),
      value: z.string().refine((value) => Number.isFinite(Number(value)), {
        message: "Expected a millisecond timestamp string",
      }),
    })
    .merge(filterValueLabelSchema),
  z
    .object({
      name: z.literal("customField"),
      key: z.string().min(1),
      condition: z.enum([
        "is",
        "is_not",
        "contains",
        "not_contains",
        "has",
        "not_has",
        "before",
        "after",
        "on",
        "exists",
        "not_exists",
      ]),
      value: z.string().optional(),
    })
    .merge(filterValueLabelSchema)
    .superRefine((filter, ctx) => {
      if (
        !["exists", "not_exists"].includes(filter.condition) &&
        typeof filter.value !== "string"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected a value for this custom field filter",
          path: ["value"],
        });
      }
    }),
]);

export const contactFilterSchema = z.object({
  aggregator: z.enum(["and", "or"]),
  filters: z.array(contactFilterConditionSchema),
});

export const sequenceReportSchema = z.object({
  broadcast: z
    .object({
      sentAt: z.number().nullable(),
      lockedAt: z.number().nullable(),
    })
    .optional(),
  sequence: z
    .object({
      subscribers: z.array(z.string()).optional(),
      unsubscribers: z.array(z.string()).optional(),
      failed: z.array(z.string()).optional(),
    })
    .optional(),
});

export const sequenceSchema = z.object({
  sequenceId: z.string(),
  // Plain strings (see `contactSchema.lead`'s comment) — validated on write.
  type: z.string(),
  title: z.string(),
  status: z.string(),
  deliverySource: deliverySourceSelectionSchema.nullable(),
  triggerType: z.string().nullable().optional(),
  triggerData: z.string().nullable().optional(),
  filter: z.any().nullable().optional(),
  excludeFilter: z.any().nullable().optional(),
  /** Active enrollments for a sequence or its locked recipient count for a broadcast. */
  entrantsCount: z.number().int().nonnegative().optional(),
  emailsOrder: z.array(z.string()),
  entrants: z.array(z.string()),
  report: z.any(),
  /** Whether sends link a hosted web version ("View in browser"). On for
   * new broadcasts, off for new sequences. */
  viewInBrowser: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  emails: z.array(sequenceEmailSchema),
  /** Set while a running broadcast of a new hosted organization is sent
   * gradually (`get` only). */
  pacing: z
    .object({
      reason: z.enum(["new_account"]),
      hourlyLimit: z.number().int(),
      dailyLimit: z.number().int(),
      remaining: z.number().int(),
      estimatedCompletionAt: z.string(),
    })
    .nullable()
    .optional(),
});

export const listSequencesQuerySchema = z.object({
  type: z.enum(mailTypes),
  offset: z.coerce.number().int().min(1).optional(),
  itemsPerPage: z.coerce.number().int().min(1).max(50).optional(),
});

export const createSequenceBodySchema = z.object({
  type: z.enum(mailTypes),
  templateId: z.string().min(1),
  deliverySource: deliverySourceSelectionSchema.optional(),
});

export const updateSequenceBodySchema = z.object({
  title: z.string().optional(),
  triggerType: z.string().optional(),
  triggerData: z.string().optional(),
  filter: contactFilterSchema
    .optional()
    .describe(
      "Audience: subscribed contacts matching this filter; empty means everyone",
    ),
  excludeFilter: contactFilterSchema
    .nullable()
    .optional()
    .describe(
      "Contacts matching this filter are left out of the audience, even when they match `filter`. `null` clears it.",
    ),
  emailsOrder: z.array(z.string()).optional(),
  /** `null` clears the intent so the default is resolved on next start. */
  deliverySource: deliverySourceSelectionSchema.nullable().optional(),
  viewInBrowser: z
    .boolean()
    .optional()
    .describe(
      'Whether emails link a hosted web version ("View in browser"). `false` leaves the link out of later sends and takes down the web versions behind links already sent. Can be changed at any time.',
    ),
});

export const addSequenceEmailBodySchema = z.object({
  templateId: z.string().min(1),
});

export const updateSequenceEmailBodySchema = z.object({
  subject: z.string().optional(),
  content: emailContentInputSchema.optional(),
  delayInMillis: z.number().optional(),
  templateId: z.string().min(1).optional(),
  actionType: z.enum(emailActionTypes).optional(),
  actionData: z.record(z.any()).optional(),
  published: z.boolean().optional(),
});

export const sendSequenceEmailTestBodySchema = z.object({
  to: z
    .array(z.string().email())
    .max(5)
    .optional()
    .describe(
      "Up to 5 addresses. Defaults to the signed-in user's address; API keys must set it.",
    ),
});

export const sequenceEmailTestResultSchema = z.object({
  sent: z.array(z.string()).describe("Addresses the test was sent to"),
  skipped: z
    .array(z.object({ email: z.string(), reason: z.enum(["suppressed"]) }))
    .describe("Addresses on the suppression list, which never get mail"),
  lastTestSentAt: z.string().nullable(),
});

export const sequenceStatsSchema = z.object({
  sent: z.number(),
  openRate: z.number(),
  clickThroughRate: z.number(),
  subscribersCount: z.number(),
  /** Share of accepted emails that bounced / were marked as spam (0-1). */
  bounceRate: z.number().optional(),
  complaintRate: z.number().optional(),
});

export const listSubscribersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});
