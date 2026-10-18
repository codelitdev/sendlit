import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createApiKey,
    createOrganizationApiKey,
    deleteApiKey,
    getApiKeyBySecret,
    getApiKeysByTeamId,
    getOrganizationApiKeyBySecret,
    registerConfiguredOrganizationApiKey,
    revokeOrganizationApiKey,
} from "./queries";
import { API_KEY_PREFIX, generateOrganizationApiKeySecret } from "./secret";
import { organizationApiKeys } from "../db/schema";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("api key queries (integration)", () => {
    it("mints a key once, stores only the hash, and resolves by secret", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const { apiKey, secret } = await createApiKey(team.id, "CI");
        expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
        expect(apiKey.keyHash).not.toContain(
            secret.slice(API_KEY_PREFIX.length),
        );
        expect(apiKey.keyPrefix).toBe(secret.slice(0, 12));

        const found = await getApiKeyBySecret(secret);
        expect(found?.id).toBe(apiKey.id);
        expect(await getApiKeyBySecret("sl_live_wrong")).toBeNull();

        expect(await getApiKeysByTeamId(team.id)).toHaveLength(1);

        await deleteApiKey(team.id, apiKey.teamApiKeyId);
        expect(await getApiKeysByTeamId(team.id)).toMatchObject([
            { teamApiKeyId: apiKey.teamApiKeyId, revokedAt: expect.any(Date) },
        ]);
        expect(await getApiKeyBySecret(secret)).toBeNull();
    });

    it("scopes keys to a team", async () => {
        const one = await seedTeamAndContact(tdb);
        const two = await seedTeamAndContact(tdb);

        await createApiKey(one.team.id, "A");
        await createApiKey(two.team.id, "B");

        expect(await getApiKeysByTeamId(one.team.id)).toHaveLength(1);
        expect(await getApiKeysByTeamId(two.team.id)).toHaveLength(1);
    });

    it("registers configured organization keys idempotently and stores only hashes", async () => {
        const { organization } = await seedTeamAndContact(tdb);
        const secret = generateOrganizationApiKeySecret();
        const scopes = ["organization:read", "teams:provision", "teams:read"];

        const first = await registerConfiguredOrganizationApiKey(
            organization.id,
            "CourseLit provisioning",
            scopes,
            secret,
        );
        const second = await registerConfiguredOrganizationApiKey(
            organization.id,
            "CourseLit provisioning",
            [...scopes].reverse(),
            secret,
        );

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.apiKey.id).toBe(first.apiKey.id);
        expect(first.apiKey.keyHash).not.toContain(secret);
        expect(first.apiKey.keyPrefix).toBe(secret.slice(0, 12));
        expect(await getOrganizationApiKeyBySecret(secret)).toMatchObject({
            id: first.apiKey.id,
            organizationId: organization.id,
            scopes,
        });
        expect(
            await tdb
                .select()
                .from(organizationApiKeys)
                .where(eq(organizationApiKeys.organizationId, organization.id)),
        ).toHaveLength(1);
    });

    it("fails closed for configured key scope, organization, format, and revocation mismatches", async () => {
        const first = await seedTeamAndContact(tdb);
        const second = await seedTeamAndContact(tdb);
        const secret = generateOrganizationApiKeySecret();
        const scopes = ["organization:read", "delivery:manage"];
        const created = await registerConfiguredOrganizationApiKey(
            first.organization.id,
            "Delivery setup",
            scopes,
            secret,
        );

        await expect(
            registerConfiguredOrganizationApiKey(
                first.organization.id,
                "Delivery setup",
                ["organization:read"],
                secret,
            ),
        ).rejects.toThrow("configured_organization_api_key_scope_mismatch");
        await expect(
            registerConfiguredOrganizationApiKey(
                second.organization.id,
                "Delivery setup",
                scopes,
                secret,
            ),
        ).rejects.toThrow("configured_organization_api_key_org_mismatch");
        await expect(
            registerConfiguredOrganizationApiKey(
                first.organization.id,
                "Delivery setup",
                scopes,
                "not-a-valid-key",
            ),
        ).rejects.toThrow("configured_organization_api_key_invalid");

        expect(
            await revokeOrganizationApiKey(
                first.organization.id,
                created.apiKey.organizationApiKeyId,
            ),
        ).toBe(true);
        await expect(
            registerConfiguredOrganizationApiKey(
                first.organization.id,
                "Delivery setup",
                scopes,
                secret,
            ),
        ).rejects.toThrow("configured_organization_api_key_revoked");
        expect(await getOrganizationApiKeyBySecret(secret)).toBeNull();
    });

    it("does not allow a generated key with a different role to impersonate a configured key", async () => {
        const { organization } = await seedTeamAndContact(tdb);
        const { secret } = await createOrganizationApiKey(
            organization.id,
            "Existing key",
            ["organization:read", "teams:read"],
        );

        await expect(
            registerConfiguredOrganizationApiKey(
                organization.id,
                "Existing key",
                ["organization:read", "teams:provision", "teams:read"],
                secret,
            ),
        ).rejects.toThrow("configured_organization_api_key_scope_mismatch");
    });

    it("fails closed when a configured key is expired", async () => {
        const { organization } = await seedTeamAndContact(tdb);
        const secret = generateOrganizationApiKeySecret();
        const scopes = ["organization:read", "teams:provision", "teams:read"];
        const created = await registerConfiguredOrganizationApiKey(
            organization.id,
            "Expired provisioning key",
            scopes,
            secret,
        );
        await tdb
            .update(organizationApiKeys)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(organizationApiKeys.id, created.apiKey.id));

        await expect(
            registerConfiguredOrganizationApiKey(
                organization.id,
                "Expired provisioning key",
                scopes,
                secret,
            ),
        ).rejects.toThrow("configured_organization_api_key_expired");
        expect(await getOrganizationApiKeyBySecret(secret)).toBeNull();
    });
});
