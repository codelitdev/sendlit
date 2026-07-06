import { z } from "zod";

export const teamSchema = z.object({
    teamId: z.string(),
    name: z.string(),
    ownerAccountId: z.string(),
    externalId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
});

/** The key's secret is stored hashed and never returned after creation —
 * list/read surfaces only ever see `keyPrefix` (e.g. `sl_live_a1b2`). */
export const apiKeySchema = z.object({
    id: z.string(),
    keyPrefix: z.string(),
    name: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
});

/** Creation is the one response that carries the full `sl_live_...` secret. */
export const createdApiKeySchema = apiKeySchema.extend({
    key: z.string(),
});

export const createTeamBodySchema = z.object({ name: z.string().min(1) });
export const renameTeamBodySchema = z.object({ name: z.string().min(1) });
export const createApiKeyBodySchema = z.object({ name: z.string().min(1) });

export const provisionTeamBodySchema = z.object({
    externalId: z.string().min(1),
    ownerEmail: z.string().email(),
    name: z.string().min(1),
});

export const provisionTeamResponseSchema = z.object({
    teamId: z.string(),
    name: z.string(),
    /** Full API key secret — present only on the call that actually created
     * the team. Keys are stored hashed, so repeat (idempotent) calls cannot
     * return it again; the consumer must store it on first provision. */
    apiKey: z.string().optional(),
});
