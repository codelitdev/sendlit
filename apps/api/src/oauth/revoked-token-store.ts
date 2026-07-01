import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { oauthRevokedTokens } from "../db/schema";

export async function isTokenRevoked(jti: string): Promise<boolean> {
    const [row] = await db
        .select({ jti: oauthRevokedTokens.jti })
        .from(oauthRevokedTokens)
        .where(eq(oauthRevokedTokens.jti, jti))
        .limit(1);
    return !!row;
}

export async function revokeToken(data: {
    jti: string;
    tokenType: string;
    accountId: string;
    clientId: string;
    expiresAt: Date;
}): Promise<void> {
    await db
        .insert(oauthRevokedTokens)
        .values({ ...data, revokedAt: new Date() })
        .onConflictDoNothing({ target: oauthRevokedTokens.jti });
}
