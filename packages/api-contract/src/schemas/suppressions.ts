import { z } from "zod";

export const suppressionReason = [
    "hard_bounce",
    "complaint",
    "repeated_soft_bounce",
    "provider_suppression",
    "manual",
] as const;

/** Per-workspace do-not-send entry — see
 * `docs/bounces-and-complaints.md#8-suppression-model`. Never derived from
 * `contacts.subscribed`; survives contact deletion/reimport. */
export const suppressionSchema = z.object({
    suppressionId: z.string(),
    recipientEmail: z.string().nullable(),
    reason: z.enum(suppressionReason),
    active: z.boolean(),
    firstSuppressedAt: z.string(),
    lastSuppressedAt: z.string(),
    releasedAt: z.string().nullable().optional(),
    releaseReason: z.string().nullable().optional(),
});

export const listSuppressionsQuerySchema = z.object({
    active: z.coerce.boolean().optional(),
    reason: z.enum(suppressionReason).optional(),
    offset: z.coerce.number().int().min(1).optional(),
    itemsPerPage: z.coerce.number().int().min(1).optional(),
});

export const releaseSuppressionBodySchema = z.object({
    explanation: z.string().min(1).max(2000).optional(),
});
