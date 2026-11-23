import { z } from "zod";
import { deliverySourceSelectionSchema } from "./delivery";

export const transactionalEmailStatus = [
  "queued",
  "sent",
  "failed",
  "bounced",
  "suppressed",
] as const;

/** Public row shape — internal `id`/`teamId` are omitted (`omitInternal`),
 * dates serialized via `serializeDates`, like every other resource schema.
 * `templateId` is the public `tpl_` id; null for inline-html sends and after
 * template deletion (the FK is `SET NULL` — `html`/`subject` stay
 * snapshotted on the row regardless). */
export const transactionalEmailSchema = z.object({
  txeId: z.string(),
  to: z.string(),
  from: z.string().nullable(),
  replyTo: z.string().nullable(),
  subject: z.string(),
  templateId: z.string().nullable(),
  variables: z.record(z.any()),
  status: z.enum(transactionalEmailStatus),
  error: z.string().nullable(),
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  openCount: z.number(),
  clickCount: z.number(),
  sentAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

/** `get` additionally returns the rendered snapshot; `list` omits it to keep
 * pages light. */
export const transactionalEmailDetailSchema = transactionalEmailSchema.extend({
  html: z.string().nullable(),
  /** Caller-supplied plain text; `null` when it was generated from `html`. */
  text: z.string().nullable().optional(),
});

/** A sender name a caller may set for one send. Only the display name: the
 * address is always the delivery source's verified one. Refused, so the name
 * can't break the From header or pass for an address:
 * - control characters (`Cc`), which include line breaks;
 * - invisible formatting characters (`Cf`), such as right-to-left overrides
 *   and zero-width spaces, which can make a name read as something else;
 * - `<`, `>` and `@`.
 * Anything else is quoted when the header is built. */
export const MAX_SENDER_NAME_LENGTH = 100;

export function isValidSenderName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_SENDER_NAME_LENGTH &&
    !/[\p{Cc}\p{Cf}<>@]/u.test(trimmed)
  );
}

export const senderNameSchema = z
  .string()
  .refine(isValidSenderName, {
    message: `1-${MAX_SENDER_NAME_LENGTH} characters, without control or invisible formatting characters, <, > or @`,
  })
  .describe(
    "The From name for this email, instead of the delivery source's. The address stays the delivery source's.",
  );

/** Headers the send pipeline owns — caller-supplied values would spoof the
 * resolved sender identity or corrupt the MIME envelope. */
const reservedHeaders = ["from", "to", "subject", "content-type"] as const;

export const emailHeadersSchema = z.record(z.string()).superRefine((headers, ctx) => {
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Header names and values must not contain CR/LF characters",
      });
    } else if ((reservedHeaders as readonly string[]).includes(name.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Header "${name}" is set by the send pipeline and cannot be overridden`,
      });
    }
  }
});

export const sendEmailBodySchema = z
  .object({
    to: z.string().email(),
    subject: z.string().min(1),
    templateId: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
    text: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Plain-text part, sent verbatim. When omitted it is generated from the HTML.",
      ),
    variables: z.record(z.any()).optional(),
    fromName: senderNameSchema.optional(),
    replyTo: z.string().email().optional(),
    headers: emailHeadersSchema.optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
    trackOpens: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
    deliverySource: deliverySourceSelectionSchema.optional(),
  })
  .refine((body) => !!body.templateId !== !!body.html, {
    message: "Provide exactly one of templateId or html",
  })
  .refine((body) => !(body.html && body.variables), {
    message: "variables requires templateId; inline html is sent verbatim",
  });

/** `202` body — deliberately minimal (Resend-style); poll `get` for status. */
export const sendEmailResponseSchema = transactionalEmailSchema.pick({
  txeId: true,
  status: true,
});

/** A template's unguarded Liquid merge tags were not all provided in the
 * request's `variables`. No transactional record is created or queued. */
export const missingTemplateVariablesErrorSchema = z.object({
  error: z.literal("missing_template_variables"),
  missingVariables: z.array(z.string()).min(1),
});

export const listTransactionalEmailsQuerySchema = z.object({
  status: z.enum(transactionalEmailStatus).optional(),
  createdAfter: z.coerce
    .number()
    .int()
    .optional()
    .describe("Millisecond timestamp lower bound (inclusive)"),
  createdBefore: z.coerce
    .number()
    .int()
    .optional()
    .describe("Millisecond timestamp upper bound (exclusive)"),
  offset: z.coerce.number().int().min(1).optional(),
  itemsPerPage: z.coerce.number().int().min(1).max(50).optional(),
});
