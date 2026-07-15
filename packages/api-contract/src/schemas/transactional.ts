import { z } from "zod";

export const transactionalEmailStatus = [
    "queued",
    "sent",
    "failed",
    "bounced",
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
});

/** Headers the send pipeline owns — caller-supplied values would spoof the
 * resolved sender identity or corrupt the MIME envelope. */
const reservedHeaders = ["from", "to", "subject", "content-type"] as const;

export const emailHeadersSchema = z
    .record(z.string())
    .superRefine((headers, ctx) => {
        for (const [name, value] of Object.entries(headers)) {
            if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "Header names and values must not contain CR/LF characters",
                });
            } else if (
                (reservedHeaders as readonly string[]).includes(
                    name.toLowerCase(),
                )
            ) {
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
        variables: z.record(z.any()).optional(),
        replyTo: z.string().email().optional(),
        headers: emailHeadersSchema.optional(),
        idempotencyKey: z.string().min(1).max(256).optional(),
        trackOpens: z.boolean().optional(),
        trackClicks: z.boolean().optional(),
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
    itemsPerPage: z.coerce.number().int().min(1).optional(),
});
