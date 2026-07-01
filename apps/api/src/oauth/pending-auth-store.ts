import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client";
import { oauthPendingAuth } from "../db/schema";

export interface PendingAuth {
    pendingId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
    state?: string | null;
    scope?: string | null;
    email?: string | null;
    otpHash?: string | null;
    otpExpires?: number | null;
    otpSentAt?: number | null;
    otpAttempts: number;
    authorizationCode?: string | null;
    expiresAt: Date;
}

export async function createPendingAuth(
    data: Omit<PendingAuth, "otpAttempts"> & { otpAttempts?: number },
): Promise<void> {
    await db.insert(oauthPendingAuth).values({
        pendingId: data.pendingId,
        clientId: data.clientId,
        redirectUri: data.redirectUri,
        codeChallenge: data.codeChallenge ?? null,
        codeChallengeMethod: data.codeChallengeMethod ?? null,
        state: data.state ?? null,
        scope: data.scope ?? null,
        email: data.email ?? null,
        otpHash: data.otpHash ?? null,
        otpExpires: data.otpExpires ?? null,
        otpSentAt: data.otpSentAt ?? null,
        otpAttempts: data.otpAttempts ?? 0,
        authorizationCode: data.authorizationCode ?? null,
        expiresAt: data.expiresAt,
    });
}

export async function findPendingAuthNotExpired(
    pendingId: string,
): Promise<PendingAuth | null> {
    const [row] = await db
        .select()
        .from(oauthPendingAuth)
        .where(
            and(
                eq(oauthPendingAuth.pendingId, pendingId),
                gt(oauthPendingAuth.expiresAt, new Date()),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function updatePendingAuth(
    pendingId: string,
    patch: Partial<Omit<PendingAuth, "pendingId">>,
): Promise<void> {
    await db
        .update(oauthPendingAuth)
        .set(patch)
        .where(eq(oauthPendingAuth.pendingId, pendingId));
}

export async function incrementOtpAttempts(
    pendingId: string,
): Promise<PendingAuth | null> {
    const existing = await findPendingAuthNotExpired(pendingId);
    if (!existing) return null;
    const [row] = await db
        .update(oauthPendingAuth)
        .set({ otpAttempts: existing.otpAttempts + 1 })
        .where(eq(oauthPendingAuth.pendingId, pendingId))
        .returning();
    return row ?? null;
}
