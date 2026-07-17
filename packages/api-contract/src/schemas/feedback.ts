import { z } from "zod";

/** Providers that ship a reviewed webhook adapter — see
 * `docs/bounces-and-complaints.md`'s provider support matrix. A provider not
 * in this list (including SES, still its own rollout phase) has no
 * `/feedback` support yet; SMTP/custom never will (synchronous-only). */
export const feedbackCapableProviders = ["resend", "postmark"] as const;

export const feedbackConnectionStatus = [
    "pending",
    "healthy",
    "stale",
    "error",
    "retiring",
    "disabled",
] as const;

/** Public shape only — credentials are never returned, only whether one is
 * configured. */
export const feedbackConnectionSchema = z.object({
    connectionId: z.string(),
    espId: z.string(),
    provider: z.string(),
    webhookUrl: z.string(),
    hasCredential: z.boolean(),
    status: z.enum(feedbackConnectionStatus),
    lastReceivedAt: z.string().nullable().optional(),
    lastVerifiedAt: z.string().nullable().optional(),
    lastErrorCode: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});

/**
 * The connection's `provider` is always the ESP's *current* `provider` —
 * not client-writable here. Changing the ESP's own provider (via
 * `PATCH /settings/esps/:espId`) retires the old connection; this endpoint
 * then creates the new one on next call.
 */
export const upsertFeedbackConnectionBodySchema = z.object({
    /** The provider's webhook signing secret / public key / shared header
     * value, depending on provider. Never returned after this call. */
    credential: z.string().min(1),
    /** SES only (reserved — not usable until the platform/SES phase ships). */
    expectedTopicArn: z.string().optional(),
});

export const testFeedbackConnectionResponseSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});
