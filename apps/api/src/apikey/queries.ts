import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { apiKeys } from "../db/schema";
import {
    displayPrefix,
    generateApiKeySecret,
    hashApiKeySecret,
} from "./secret";

export type ApiKey = typeof apiKeys.$inferSelect;

export type CreatedApiKey = {
    apiKey: ApiKey;
    /** The full `sl_live_...` secret. Only available here, at creation — it
     * is stored hashed, so it can never be shown again. */
    secret: string;
};

/** A key authenticates as exactly one team (see `db/schema.ts`'s comment on
 * `apiKeys`) — a team can have several, independently named/revocable. */
export async function createApiKey(
    teamId: string,
    name: string,
): Promise<CreatedApiKey> {
    const secret = generateApiKeySecret();
    const [apiKey] = await db
        .insert(apiKeys)
        .values({
            teamId,
            name,
            keyHash: hashApiKeySecret(secret),
            keyPrefix: displayPrefix(secret),
        })
        .returning();
    return { apiKey, secret };
}

export async function getApiKeyBySecret(
    secret: string,
): Promise<ApiKey | null> {
    const [row] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, hashApiKeySecret(secret)))
        .limit(1);
    return row ?? null;
}

export async function getApiKeysByTeamId(teamId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.teamId, teamId));
}

export async function deleteApiKey(
    teamId: string,
    keyId: string,
): Promise<void> {
    await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.teamId, teamId), eq(apiKeys.id, keyId)));
}
