import { z } from "zod";
import { customFieldsSchema } from "./custom-fields";

/** Custom events (`POST /events`) and the triggers that react to them —
 * see `apps/api/docs/custom_events.md`. */

export const EVENT_NAME_MAX_LENGTH = 128;
export const EVENT_PROPERTIES_MAX_BYTES = 32 * 1024;
export const EVENT_PROPERTIES_MAX_KEYS = 100;
export const EVENT_PROPERTIES_MAX_DEPTH = 3;
export const EVENT_DEFINITIONS_MAX = 500;
export const EVENT_FILTER_MAX_CONDITIONS = 10;
/** Events older than this (by `occurredAt`) are stored but never trigger. */
export const EVENT_STALE_AFTER_MS = 72 * 60 * 60 * 1000;
/** How far ahead of the receive time `occurredAt` may be. */
export const EVENT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export const eventPropertyKeyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const controlCharacters = /[\u0000-\u001f\u007f]/;

/** One normalization for event names everywhere they appear: the ingest
 * body, definition paths and `triggerData` of an `event:custom` trigger.
 * Case-sensitive. A leading `$` is reserved for system events. */
export const eventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(EVENT_NAME_MAX_LENGTH)
  .refine((name) => !controlCharacters.test(name), {
    message: "Event names can't contain control characters",
  })
  .refine((name) => !name.startsWith("$"), {
    message: "Event names can't start with $",
  });

function propertiesProblem(value: unknown, depth: number): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = propertiesProblem(item, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (value && typeof value === "object") {
    if (depth >= EVENT_PROPERTIES_MAX_DEPTH) {
      return `Properties can be nested at most ${EVENT_PROPERTIES_MAX_DEPTH} levels`;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (!eventPropertyKeyPattern.test(key)) {
        return `Property key "${key}" must start with a letter or _ and contain only letters, digits and _ (max 64)`;
      }
      const problem = propertiesProblem(nested, depth + 1);
      if (problem) return problem;
    }
  }
  return null;
}

export const eventPropertiesSchema = z
  .record(z.unknown())
  .superRefine((properties, ctx) => {
    if (Object.keys(properties).length > EVENT_PROPERTIES_MAX_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At most ${EVENT_PROPERTIES_MAX_KEYS} top-level properties`,
      });
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(properties)).length;
    if (bytes > EVENT_PROPERTIES_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Properties can be at most ${EVENT_PROPERTIES_MAX_BYTES} bytes as JSON`,
      });
      return;
    }
    const problem = propertiesProblem(properties, 0);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

/** The `POST /events` fields, without the cross-field rules — MCP tools
 * take a raw shape and validate with `trackEventBodySchema` themselves. */
export const trackEventFieldsSchema = z
  .object({
    email: z.string().email().optional(),
    contactId: z.string().min(1).optional(),
    eventName: eventNameSchema,
    properties: eventPropertiesSchema.optional(),
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("When it happened. At most 24 h in the future; defaults to now."),
    idempotencyKey: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("The same key within 30 days stores one event and enrolls once."),
    backfill: z
      .boolean()
      .optional()
      .describe("Record only: the event never starts a sequence."),
    createContact: z
      .boolean()
      .optional()
      .describe(
        "Create the contact when the email is unknown (default true). Ignored with contactId.",
      ),
    contact: z
      .object({
        name: z.string().optional(),
        customFields: customFieldsSchema.optional(),
      })
      .strict()
      .optional()
      .describe(
        "Applied to the contact. Custom fields are merged into the existing ones.",
      ),
  })
  .strict();

export const trackEventBodySchema = trackEventFieldsSchema
  .refine((body) => !!body.email !== !!body.contactId, {
    message: "Provide exactly one of email or contactId",
  })
  .refine(
    (body) =>
      !body.occurredAt ||
      new Date(body.occurredAt).getTime() <= Date.now() + EVENT_MAX_FUTURE_MS,
    { message: "occurredAt can be at most 24 hours in the future" },
  );

export const trackEventResponseSchema = z.object({
  eventId: z.string(),
  contactId: z.string(),
  duplicate: z.boolean(),
  contactCreated: z.boolean(),
});

export const eventSources = ["api", "session", "mcp"] as const;

export const contactEventSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  properties: z.record(z.unknown()),
  occurredAt: z.string(),
  receivedAt: z.string(),
  source: z.enum(eventSources),
  backfill: z.boolean(),
  triggers: z.boolean(),
  enrolledSequences: z.array(z.object({ sequenceId: z.string(), title: z.string() })),
});

export const listContactEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  name: eventNameSchema.optional(),
});

export const eventPropertyTypes = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
] as const;

export const eventDefinitionPropertySchema = z.object({
  key: z.string().regex(eventPropertyKeyPattern),
  type: z.enum(eventPropertyTypes),
  declared: z.boolean(),
});

export const eventDefinitionSchema = z.object({
  name: z.string(),
  origin: z.enum(["received", "manual"]),
  description: z.string().nullable(),
  properties: z.array(eventDefinitionPropertySchema),
  firstSeenAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  /** Non-deleted sequences whose trigger is this event. */
  sequenceCount: z.number().int(),
});

export const eventDefinitionDetailSchema = eventDefinitionSchema.extend({
  lastProperties: z.record(z.unknown()).nullable(),
});

const declaredPropertiesSchema = z
  .array(
    z.object({
      key: z.string().regex(eventPropertyKeyPattern),
      type: z.enum(eventPropertyTypes),
    }),
  )
  .max(EVENT_PROPERTIES_MAX_KEYS)
  .refine((props) => new Set(props.map((p) => p.key)).size === props.length, {
    message: "Property keys must be unique",
  });

export const createEventDefinitionBodySchema = z
  .object({
    name: eventNameSchema,
    description: z.string().max(500).optional(),
    properties: declaredPropertiesSchema.optional(),
  })
  .strict();

export const updateEventDefinitionBodySchema = z
  .object({
    description: z.string().max(500).nullable().optional(),
    properties: declaredPropertiesSchema
      .optional()
      .describe("Replaces the declared properties. Observed keys stay."),
  })
  .strict();

const filterScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const eventFilterConditions = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
] as const;

/** Dot path, up to 3 levels, each segment a valid property key. */
const eventFilterKeySchema = z.string().refine(
  (key) => {
    const parts = key.split(".");
    return (
      parts.length <= EVENT_PROPERTIES_MAX_DEPTH &&
      parts.every((part) => eventPropertyKeyPattern.test(part))
    );
  },
  { message: "Use a property key, or a dot path up to 3 levels" },
);

export const eventPropertyFilterSchema = z.object({
  aggregator: z.enum(["and", "or"]),
  filters: z
    .array(
      z
        .object({
          key: eventFilterKeySchema,
          condition: z.enum(eventFilterConditions),
          value: filterScalarSchema.optional(),
        })
        .refine(
          (f) =>
            f.condition === "exists" ||
            f.condition === "not_exists" ||
            f.value !== undefined,
          { message: "This condition needs a value" },
        ),
    )
    .min(1)
    .max(EVENT_FILTER_MAX_CONDITIONS),
});

export const propertyChangeFilterSchema = z
  .object({
    from: filterScalarSchema.nullable().optional(),
    to: filterScalarSchema.nullable().optional(),
  })
  .strict();

export type EventPropertyFilter = z.infer<typeof eventPropertyFilterSchema>;
export type PropertyChangeFilter = z.infer<typeof propertyChangeFilterSchema>;
export type TrackEventBody = z.infer<typeof trackEventBodySchema>;
export type ContactEvent = z.infer<typeof contactEventSchema>;
export type EventDefinition = z.infer<typeof eventDefinitionSchema>;
export type EventDefinitionDetail = z.infer<typeof eventDefinitionDetailSchema>;
