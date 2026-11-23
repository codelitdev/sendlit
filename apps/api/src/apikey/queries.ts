import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client";
import { organizationApiKeys, teamApiKeys } from "../db/schema";
import logger from "../services/log";
import {
  displayPrefix,
  generateApiKeySecret,
  generateOrganizationApiKeySecret,
  hashApiKeySecret,
  isOrganizationApiKeySecret,
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

export async function getApiKeyBySecret(secret: string): Promise<ApiKey | null> {
  const [row] = await db
    .select()
    .from(teamApiKeys)
    .where(
      and(
        eq(teamApiKeys.keyHash, hashApiKeySecret(secret)),
        isNull(teamApiKeys.revokedAt),
        or(isNull(teamApiKeys.expiresAt), gt(teamApiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getApiKeysByTeamId(teamId: string): Promise<ApiKey[]> {
  return db.select().from(teamApiKeys).where(eq(teamApiKeys.teamId, teamId));
}

export async function deleteApiKey(teamId: string, keyId: string): Promise<void> {
  await db
    .update(teamApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(teamApiKeys.teamId, teamId), eq(teamApiKeys.teamApiKeyId, keyId)));
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

/** Register an operator-supplied organization key without ever returning or
 * logging its plaintext. Re-running bootstrap with the same secret and role
 * is a no-op; a revoked, expired, or cross-organization key fails closed
 * instead of being silently repaired. A key whose stored scopes differ also
 * fails closed, unless the caller passes `reconcileScopes` and the key carries
 * the same `name`: bootstrap owns the scopes of the keys it registers, so a
 * newer release can widen them on restart. A key created for another role, or
 * by hand, whose secret ends up in that setting still fails closed. */
export async function registerConfiguredOrganizationApiKey(
  organizationId: string,
  name: string,
  scopes: string[],
  secret: string,
  createdByUserId?: string,
  options: { reconcileScopes?: boolean } = {},
): Promise<{ apiKey: OrganizationApiKey; created: boolean }> {
  if (!isOrganizationApiKeySecret(secret)) {
    throw new Error("configured_organization_api_key_invalid");
  }

  const keyHash = hashApiKeySecret(secret);
  const expectedScopes = [...new Set(scopes)].sort();
  const validateExisting = async (
    apiKey: OrganizationApiKey,
  ): Promise<{ apiKey: OrganizationApiKey; created: false }> => {
    if (apiKey.organizationId !== organizationId) {
      throw new Error("configured_organization_api_key_org_mismatch");
    }
    if (apiKey.revokedAt) {
      throw new Error("configured_organization_api_key_revoked");
    }
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      throw new Error("configured_organization_api_key_expired");
    }
    const actualScopes = [...new Set(apiKey.scopes)].sort();
    if (JSON.stringify(actualScopes) !== JSON.stringify(expectedScopes)) {
      if (!options.reconcileScopes || apiKey.name !== name) {
        throw new Error("configured_organization_api_key_scope_mismatch");
      }
      const [updated] = await db
        .update(organizationApiKeys)
        .set({ scopes: expectedScopes })
        .where(eq(organizationApiKeys.id, apiKey.id))
        .returning();
      logger.info(
        {
          organizationId,
          keyName: apiKey.name,
          previousScopes: actualScopes,
          scopes: expectedScopes,
        },
        "Reconciled configured organization API key scopes",
      );
      return {
        apiKey: updated ?? { ...apiKey, scopes: expectedScopes },
        created: false,
      };
    }
    return { apiKey, created: false };
  };

  const [existing] = await db
    .select()
    .from(organizationApiKeys)
    .where(eq(organizationApiKeys.keyHash, keyHash))
    .limit(1);
  if (existing) return await validateExisting(existing);

  const [created] = await db
    .insert(organizationApiKeys)
    .values({
      organizationId,
      name,
      scopes: expectedScopes,
      keyHash,
      keyPrefix: displayPrefix(secret),
      createdByUserId,
    })
    .onConflictDoNothing({ target: organizationApiKeys.keyHash })
    .returning();
  if (created) return { apiKey: created, created: true };

  // Another bootstrap process may have registered this hash concurrently.
  const [raced] = await db
    .select()
    .from(organizationApiKeys)
    .where(eq(organizationApiKeys.keyHash, keyHash))
    .limit(1);
  if (!raced) {
    throw new Error("configured_organization_api_key_registration_conflict");
  }
  return await validateExisting(raced);
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
