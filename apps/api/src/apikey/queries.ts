import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { apiKeys } from "../db/schema";
import { generateUniqueId } from "../utils/id";

export type ApiKey = typeof apiKeys.$inferSelect;

/** A key authenticates as exactly one team (see `db/schema.ts`'s comment on
 * `apiKeys`) — a team can have several, independently named/revocable. */
export async function createApiKey(
    teamId: string,
    name: string,
): Promise<ApiKey> {
    const [key] = await db
        .insert(apiKeys)
        .values({ teamId, name, key: generateUniqueId() })
        .returning();
    return key;
}

export async function getApiKeyUsingKeyId(key: string): Promise<ApiKey | null> {
    const [row] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.key, key))
        .limit(1);
    return row ?? null;
}

export async function getApiKeysByTeamId(teamId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.teamId, teamId));
}

export async function getApiKeyByTeamIdAndKey(
    teamId: string,
    key: string,
): Promise<ApiKey | null> {
    const [row] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.teamId, teamId), eq(apiKeys.key, key)))
        .limit(1);
    return row ?? null;
}

export async function deleteApiKey(teamId: string, key: string): Promise<void> {
    await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.teamId, teamId), eq(apiKeys.key, key)));
}
