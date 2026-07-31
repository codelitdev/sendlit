import { eq, and, isNull, or, gt } from "drizzle-orm";
import { db } from "../db/client";
import { organizationApiKeys, teamApiKeys } from "../db/schema";
import {
    displayPrefix,
    generateApiKeySecret,
    generateOrganizationApiKeySecret,
    hashApiKeySecret,
} from "./secret";

export type ApiKey = typeof teamApiKeys.$inferSelect;
export type OrganizationApiKey = typeof organizationApiKeys.$inferSelect;

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
    attribution: {
        createdByType: "user" | "organization_key" | "system";
        createdById?: string;
    } = { createdByType: "user" },
    executor: any = db,
): Promise<CreatedApiKey> {
    const secret = generateApiKeySecret();
    const [apiKey] = await executor
        .insert(teamApiKeys)
        .values({
            teamId,
            name,
            keyHash: hashApiKeySecret(secret),
            keyPrefix: displayPrefix(secret),
            createdByType: attribution.createdByType,
            createdById: attribution.createdById,
        })
        .returning();
    return { apiKey, secret };
}

export async function getApiKeyBySecret(
    secret: string,
): Promise<ApiKey | null> {
    const [row] = await db
        .select()
        .from(teamApiKeys)
        .where(
            and(
                eq(teamApiKeys.keyHash, hashApiKeySecret(secret)),
                isNull(teamApiKeys.revokedAt),
                or(
                    isNull(teamApiKeys.expiresAt),
                    gt(teamApiKeys.expiresAt, new Date()),
                ),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getApiKeysByTeamId(teamId: string): Promise<ApiKey[]> {
    return db.select().from(teamApiKeys).where(eq(teamApiKeys.teamId, teamId));
}

export async function deleteApiKey(
    teamId: string,
    keyId: string,
): Promise<void> {
    await db
        .update(teamApiKeys)
        .set({ revokedAt: new Date() })
        .where(
            and(
                eq(teamApiKeys.teamId, teamId),
                eq(teamApiKeys.teamApiKeyId, keyId),
            ),
        );
}

export async function createOrganizationApiKey(
    organizationId: string,
    name: string,
    scopes: string[],
    createdByUserId?: string,
    expiresAt?: Date | null,
): Promise<{ apiKey: OrganizationApiKey; secret: string }> {
    const secret = generateOrganizationApiKeySecret();
    const [apiKey] = await db
        .insert(organizationApiKeys)
        .values({
            organizationId,
            name,
            scopes,
            keyHash: hashApiKeySecret(secret),
            keyPrefix: displayPrefix(secret),
            createdByUserId,
            expiresAt,
        })
        .returning();
    return { apiKey, secret };
}

export async function getOrganizationApiKeys(
    organizationId: string,
): Promise<OrganizationApiKey[]> {
    return db
        .select()
        .from(organizationApiKeys)
        .where(eq(organizationApiKeys.organizationId, organizationId));
}

export async function revokeOrganizationApiKey(
    organizationId: string,
    keyId: string,
): Promise<boolean> {
    const rows = await db
        .update(organizationApiKeys)
        .set({ revokedAt: new Date() })
        .where(
            and(
                eq(organizationApiKeys.organizationId, organizationId),
                eq(organizationApiKeys.organizationApiKeyId, keyId),
            ),
        )
        .returning({ id: organizationApiKeys.id });
    return rows.length > 0;
}

export async function getOrganizationApiKeyBySecret(
    secret: string,
): Promise<OrganizationApiKey | null> {
    const [row] = await db
        .select()
        .from(organizationApiKeys)
        .where(
            and(
                eq(organizationApiKeys.keyHash, hashApiKeySecret(secret)),
                isNull(organizationApiKeys.revokedAt),
                or(
                    isNull(organizationApiKeys.expiresAt),
                    gt(organizationApiKeys.expiresAt, new Date()),
                ),
            ),
        )
        .limit(1);
    return row ?? null;
}
