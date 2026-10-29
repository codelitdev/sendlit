import { z } from "zod";
import { emailContentInputSchema, emailContentSchema } from "./common";
import { deliverySourceSelectionSchema } from "./delivery";
import { eventPropertyFilterSchema, propertyChangeFilterSchema } from "./events";

export const mailTypes = ["broadcast", "sequence"] as const;
export const sequenceStatus = ["draft", "active", "paused", "completed"] as const;
export const emailActionTypes = ["tag:add", "tag:remove"] as const;

/** Every trigger a sequence row can carry. Broadcasts use `date:occurred`. */
export const triggerTypes = [
  "subscriber:added",
  "tag:added",
  "tag:removed",
  "date:occurred",
  "event:custom",
  "contact:property_changed",
] as const;
/** The triggers a `type = 'sequence'` row may use. */
export const sequenceTriggerTypes = [
  "subscriber:added",
  "tag:added",
  "tag:removed",
  "event:custom",
  "contact:property_changed",
] as const;
export type TriggerTypeValue = (typeof triggerTypes)[number];

export const reentryModes = ["every_time", "once", "once_per_period"] as const;
export type ReentryMode = (typeof reentryModes)[number];

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
  triggerType: z.enum(triggerTypes).nullable().optional(),
  triggerData: z.string().nullable().optional(),
  /** Property filter (`event:custom`) or from/to filter
   * (`contact:property_changed`). */
  triggerFilter: z.any().nullable().optional(),
  /** Who can enter again: sequences only. */
  reentry: z.enum(reentryModes).optional(),
  reentryPeriodDays: z.number().int().nullable().optional(),
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
  /** When a sent broadcast was archived; `null` when it isn't. */
  archivedAt: z.string().nullable().optional(),
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

export const archivedFilters = ["exclude", "only", "include"] as const;

export const listSequencesQuerySchema = z.object({
  type: z.enum(mailTypes),
  archived: z
    .enum(archivedFilters)
    .optional()
    .describe(
      "Archived broadcasts: exclude (default) hides them, only lists just them, include lists both",
    ),
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
  triggerType: z
    .enum(triggerTypes)
    .optional()
    .describe(
      "Broadcasts use date:occurred. Sequences: subscriber:added, tag:added, tag:removed, event:custom or contact:property_changed.",
    ),
  triggerData: z
    .string()
    .optional()
    .describe(
      "Tag name for tag triggers, event name for event:custom, custom field key for contact:property_changed.",
    ),
  triggerFilter: z
    .union([eventPropertyFilterSchema, propertyChangeFilterSchema])
    .nullable()
    .optional()
    .describe(
      "event:custom: { aggregator, filters: [{ key, condition, value }] }. contact:property_changed: { from?, to? }. null clears it.",
    ),
  reentry: z
    .enum(reentryModes)
    .optional()
    .describe(
      "Sequences only. every_time (default), once, or once_per_period with reentryPeriodDays.",
    ),
  reentryPeriodDays: z.number().int().min(1).max(365).nullable().optional(),
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
  /** Event-triggered sequences: `last_event` when `{{ event.* }}` used the
   * last payload received for the event, `none` when there is none yet. */
  eventSample: z.enum(["last_event", "none"]).optional(),
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

export const sequenceDeletionPreviewSchema = z.object({
  status: z.string().describe("The broadcast or sequence's current status"),
  blocker: z
    .enum(["sequence_active", "broadcast_sent"])
    .nullable()
    .describe(
      "Why it can't be deleted right now (sequence_active: pause it first; broadcast_sent: archive the broadcast instead), or null when it can",
    ),
  enrolledCount: z
    .number()
    .int()
    .describe("Contacts currently in the sequence; deleting it stops their emails"),
  emailsSentCount: z
    .number()
    .int()
    .describe("Emails it has sent; their delivery, open and click history is deleted"),
});

export type SequenceDeletionPreview = z.infer<typeof sequenceDeletionPreviewSchema>;

export const listSubscribersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});
