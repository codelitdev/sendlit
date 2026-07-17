import { z } from "zod";

export const espProviders = [
    "smtp",
    "sendgrid",
    "mailgun",
    "postmark",
    "ses",
    "resend",
    "custom",
] as const;

/** Public shape only — the encrypted password/secret is never returned to
 * clients, only a `hasPassword` boolean (see
 * `apps/api/src/settings/esp/routes.ts`'s `toPublicShape`). */
export const espConfigSchema = z.object({
    espId: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    // Plain string, not the enum — the DB column is unconstrained text and
    // validated on write (see `upsertEspConfigBodySchema`).
    provider: z.string(),
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    username: z.string().nullable().optional(),
    hasPassword: z.boolean(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    lastTestedAt: z.string().nullable().optional(),
    lastTestStatus: z.enum(["success", "failed"]).nullable().optional(),
    lastTestError: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
});

export const upsertEspConfigBodySchema = z.object({
    provider: z.enum(espProviders),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().optional(),
    /** Omit to keep the existing secret unchanged; send `""` to clear it. */
    password: z.string().optional(),
    fromName: z.string().optional(),
    fromEmail: z.string().email().optional(),
});

export const createEspConfigBodySchema = upsertEspConfigBodySchema.extend({
    name: z.string().trim().min(1).max(100),
    isDefault: z.boolean().optional(),
});

export const updateEspConfigBodySchema = z
    .object({
        name: z.string().trim().min(1).max(100).optional(),
        provider: z.enum(espProviders).optional(),
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        secure: z.boolean().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        fromName: z.string().optional(),
        fromEmail: z.union([z.string().email(), z.literal("")]).optional(),
        isDefault: z.literal(true).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
    });

export const testEspConfigBodySchema = z.object({
    to: z.string().email().optional(),
});

export const testEspConfigResponseSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});
