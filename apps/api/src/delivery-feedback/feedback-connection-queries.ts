import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { espConfigs, espFeedbackConnections } from "../db/schema";
import { decryptSecret, encryptSecret } from "../utils/secret-crypto";
import type { FeedbackCapableProvider } from "../config/constants";

export type FeedbackConnection = typeof espFeedbackConnections.$inferSelect;

const CREDENTIAL_ROTATION_GRACE_HOURS = 24;

/** The one non-retired connection for a user ESP, if any — used by the send
 * adapter to snapshot `feedbackConnectionId` onto the outbound ledger row at
 * send time (see `docs/bounces-and-complaints.md#1-outbound-message-ledger`). */
export async function getActiveFeedbackConnectionForEspConfig(
    espConfigId: string,
): Promise<FeedbackConnection | null> {
    const [row] = await db
        .select()
        .from(espFeedbackConnections)
        .where(
            and(
                eq(espFeedbackConnections.espConfigId, espConfigId),
                ne(espFeedbackConnections.status, "retiring"),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        )
        .limit(1);
    return row ?? null;
}

/** Team-scoped lookup for the authenticated `/settings/esps/:espId/feedback`
 * routes — validates the ESP belongs to the team before returning anything. */
export async function getFeedbackConnectionForTeamEsp(
    teamId: string,
    espConfigId: string,
): Promise<FeedbackConnection | null> {
    const [row] = await db
        .select()
        .from(espFeedbackConnections)
        .where(
            and(
                eq(espFeedbackConnections.teamId, teamId),
                eq(espFeedbackConnections.espConfigId, espConfigId),
                ne(espFeedbackConnections.status, "retiring"),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        )
        .limit(1);
    return row ?? null;
}

/** Resolves a public webhook `connectionId` for the *unauthenticated*
 * provider-facing route — scoped only by connection id and provider match,
 * never by team/session. Returns `null` for a disabled connection so a
 * retired/compromised endpoint stops accepting events, but a `retiring`
 * connection still resolves (its grace-period contract). */
export async function getFeedbackConnectionByConnectionId(
    connectionId: string,
    provider: string,
): Promise<FeedbackConnection | null> {
    const [row] = await db
        .select()
        .from(espFeedbackConnections)
        .where(
            and(
                eq(espFeedbackConnections.connectionId, connectionId),
                eq(espFeedbackConnections.provider, provider),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        )
        .limit(1);
    return row ?? null;
}

/**
 * Creates a new connection for the ESP or rotates the credential on the
 * existing one, keeping the same `connectionId`/URL stable across rotation
 * (only a provider change ever mints a new URL — see
 * `retireActiveFeedbackConnection`). The previous credential remains valid
 * for {@link CREDENTIAL_ROTATION_GRACE_HOURS} so an in-flight provider retry
 * signed with it isn't rejected.
 */
export async function upsertFeedbackConnection({
    teamId,
    espConfigId,
    provider,
    credential,
    expectedTopicArn,
}: {
    teamId: string;
    espConfigId: string;
    provider: FeedbackCapableProvider;
    /** Raw webhook secret/public key/basic-auth value — encrypted before
     * storage, never returned. */
    credential: string;
    expectedTopicArn?: string | null;
}): Promise<FeedbackConnection> {
    const existing = await getFeedbackConnectionForTeamEsp(teamId, espConfigId);
    const encryptedCredentials = encryptSecret(credential);

    if (!existing) {
        const [row] = await db
            .insert(espFeedbackConnections)
            .values({
                teamId,
                espConfigId,
                scope: "custom",
                provider,
                encryptedCredentials,
                expectedTopicArn: expectedTopicArn ?? null,
                status: "pending",
            })
            .returning();
        return row;
    }

    const previousExpiresAt = new Date(
        Date.now() + CREDENTIAL_ROTATION_GRACE_HOURS * 60 * 60 * 1000,
    );
    const [row] = await db
        .update(espFeedbackConnections)
        .set({
            previousEncryptedCredentials: existing.encryptedCredentials,
            previousCredentialExpiresAt: existing.encryptedCredentials
                ? previousExpiresAt
                : null,
            encryptedCredentials,
            expectedTopicArn: expectedTopicArn ?? existing.expectedTopicArn,
            // A credential rotation on a previously-erroring connection
            // deserves a fresh chance rather than staying flagged `error`.
            status: existing.status === "error" ? "pending" : existing.status,
            lastErrorCode: null,
            updatedAt: new Date(),
        })
        .where(eq(espFeedbackConnections.id, existing.id))
        .returning();
    return row;
}

/** Called when an ESP's `provider` changes — the old feedback connection
 * (bound to the old provider's URL/verification scheme) can never serve the
 * new provider's webhooks, so it retires rather than being mutated in
 * place. A later `PUT .../feedback` call creates a fresh connection (new
 * `connectionId`) for the new provider. Authenticated, delayed/retried
 * events on the retiring connection are still accepted for a seven-day
 * grace period (enforced by callers checking `status`, not by this
 * function). */
export async function retireActiveFeedbackConnection(
    espConfigId: string,
): Promise<void> {
    await db
        .update(espFeedbackConnections)
        .set({ status: "retiring", updatedAt: new Date() })
        .where(
            and(
                eq(espFeedbackConnections.espConfigId, espConfigId),
                ne(espFeedbackConnections.status, "retiring"),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        );
}

export async function disableFeedbackConnection(
    teamId: string,
    espConfigId: string,
): Promise<boolean> {
    const [row] = await db
        .update(espFeedbackConnections)
        .set({
            status: "disabled",
            disabledAt: new Date(),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(espFeedbackConnections.teamId, teamId),
                eq(espFeedbackConnections.espConfigId, espConfigId),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        )
        .returning();
    return Boolean(row);
}

/** Called both by the manual "test" action and by the receipt processor
 * after a real event processes successfully — either way, an authenticated
 * receipt was durably handled, which is the PRD's definition of `healthy`.
 * Never promotes a `retiring`/`disabled` connection back to `healthy` — a
 * late grace-period event is still accepted and processed, but the
 * connection's lifecycle state shouldn't imply it's taking new sends again. */
export async function recordFeedbackConnectionVerified(
    id: string,
): Promise<void> {
    await db
        .update(espFeedbackConnections)
        .set({
            status: "healthy",
            lastReceivedAt: new Date(),
            lastVerifiedAt: new Date(),
            lastErrorCode: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(espFeedbackConnections.id, id),
                ne(espFeedbackConnections.status, "retiring"),
                ne(espFeedbackConnections.status, "disabled"),
            ),
        );
}

export async function recordFeedbackConnectionError(
    id: string,
    errorCode: string,
): Promise<void> {
    await db
        .update(espFeedbackConnections)
        .set({
            status: "error",
            lastErrorCode: errorCode,
            updatedAt: new Date(),
        })
        .where(eq(espFeedbackConnections.id, id));
}

/** Only records that an authenticated event arrived (used on every accepted
 * receipt, success or not) — distinct from `recordFeedbackConnectionVerified`,
 * which also flips `status` to `healthy`. Health status only improves on a
 * successfully *processed* receipt or a passing test send; this just tracks
 * recency for staleness checks. */
export async function recordFeedbackConnectionReceived(
    id: string,
): Promise<void> {
    await db
        .update(espFeedbackConnections)
        .set({ lastReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(espFeedbackConnections.id, id));
}

export interface DecryptedFeedbackCredential {
    credential: string;
    /** Present only within the 24h rotation grace window. */
    previousCredential?: string;
}

/** Decrypts both the current and (if still within its grace window) the
 * previous credential, so signature verification can try either — required
 * so an in-flight provider retry signed with a just-rotated-out secret
 * still authenticates. */
export function decryptFeedbackCredentials(
    connection: FeedbackConnection,
): DecryptedFeedbackCredential | null {
    if (!connection.encryptedCredentials) return null;
    const credential = decryptSecret(connection.encryptedCredentials);
    const stillInGrace =
        connection.previousEncryptedCredentials &&
        connection.previousCredentialExpiresAt &&
        connection.previousCredentialExpiresAt.getTime() > Date.now();
    return {
        credential,
        previousCredential: stillInGrace
            ? decryptSecret(connection.previousEncryptedCredentials!)
            : undefined,
    };
}

/** Used by `settings/esp/routes.ts` to confirm an ESP belongs to the team
 * before any feedback operation touches it (feedback routes don't have
 * their own team-scoped ESP lookup otherwise). */
export async function getTeamEspConfigById(
    teamId: string,
    espConfigId: string,
) {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            and(eq(espConfigs.id, espConfigId), eq(espConfigs.teamId, teamId)),
        )
        .limit(1);
    return row ?? null;
}
