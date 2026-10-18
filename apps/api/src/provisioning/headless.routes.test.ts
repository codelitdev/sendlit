import express from "express";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
    userId: "",
    authKind: "organization_key" as string,
    organizationId: "",
    organizationApiKeyId: "org-key-test",
    organizationScopes: [] as string[],
}));
const espTestMock = vi.hoisted(() => ({ testEspConfig: vi.fn() }));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../auth/middleware", () => ({
    requireAuth: (req: any, _res: any, next: () => void) => {
        req.userId = authState.userId;
        req.authKind = authState.authKind;
        req.organizationId = authState.organizationId;
        req.organizationApiKeyId = authState.organizationApiKeyId;
        req.organizationScopes = authState.organizationScopes;
        next();
    },
}));
vi.mock("../settings/esp/test", () => ({
    testEspConfig: espTestMock.testEspConfig,
}));

import { db } from "../db/client";
import {
    espConfigTeamGrants,
    espConfigs,
    organizationApiKeys,
    organizationAuditEvents,
    organizationDeliveryPolicies,
    organizationMembers,
    teamDeliverySettings,
    teams,
    user,
} from "../db/schema";
import { truncateAll, type TestDb } from "../test/db";
import { requestApp } from "../test/http";
import { createOrganization } from "../organization/queries";
import { createOrganizationEspConfig } from "../settings/esp/queries";
import organizationRoutes from "../organization/routes";
import provisioningRoutes from "./routes";

const tdb = db as unknown as TestDb;

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(organizationRoutes);
    instance.use(provisioningRoutes);
    return instance;
}

async function insertUser(name: string) {
    const [account] = await tdb
        .insert(user)
        .values({
            id: crypto.randomUUID(),
            name,
            email: `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        })
        .returning();
    return account;
}

async function createActiveOrganizationEsp(organizationId: string) {
    const esp = await createOrganizationEspConfig(organizationId, {
        name: "Shared SMTP",
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        fromEmail: "mail@example.com",
    });
    await tdb
        .update(espConfigs)
        .set({ status: "active" })
        .where(eq(espConfigs.id, esp.id));
    return esp;
}

function policyPath(organizationId: string) {
    return `/organizations/${organizationId}/delivery-policy`;
}

beforeEach(async () => {
    await truncateAll(tdb);
    authState.userId = "";
    authState.authKind = "organization_key";
    authState.organizationId = "";
    authState.organizationApiKeyId = "org-key-test";
    authState.organizationScopes = [];
    espTestMock.testEspConfig.mockReset().mockResolvedValue({ success: true });
});

describe("headless organization provisioning", () => {
    it("discovers only the organization bound to the calling key", async () => {
        const owner = await insertUser("Owner");
        const org = await createOrganization(owner.id, "Acme");
        const otherOwner = await insertUser("Other");
        const otherOrg = await createOrganization(otherOwner.id, "Other Org");
        authState.organizationId = org.id;
        authState.organizationScopes = ["organization:read"];

        const response = await requestApp(app(), "/provisioning/organization");
        expect(response.status).toBe(200);
        expect(response.json()).toMatchObject({
            organizationId: org.organizationId,
            name: "Acme",
        });
        expect(response.json().organizationId).not.toBe(
            otherOrg.organizationId,
        );

        authState.organizationScopes = [];
        const denied = await requestApp(app(), "/provisioning/organization");
        expect(denied.status).toBe(403);
    });

    it("requires delivery-specific scopes and enforces the key organization binding", async () => {
        const owner = await insertUser("Owner");
        const org = await createOrganization(owner.id, "Acme");
        const otherOwner = await insertUser("Other");
        const otherOrg = await createOrganization(otherOwner.id, "Other Org");
        authState.organizationId = org.id;
        authState.organizationScopes = ["esps:manage", "grants:manage"];

        expect(
            (await requestApp(app(), policyPath(org.organizationId))).status,
        ).toBe(403);
        const deniedWrite = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ autoGrantDefaultEsp: true }),
            },
        );
        expect(deniedWrite.status).toBe(403);

        authState.organizationScopes = ["delivery:read"];
        expect(
            (await requestApp(app(), policyPath(org.organizationId))).status,
        ).toBe(200);
        const deniedReadOnlyWrite = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ autoGrantDefaultEsp: true }),
            },
        );
        expect(deniedReadOnlyWrite.status).toBe(403);

        authState.organizationScopes = ["delivery:manage"];
        const foreignBinding = await requestApp(
            app(),
            policyPath(otherOrg.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ autoGrantDefaultEsp: true }),
            },
        );
        expect(foreignBinding.status).toBe(404);
    });

    it("allows an organization key to test an ESP with an explicit recipient", async () => {
        const owner = await insertUser("Owner");
        const org = await createOrganization(owner.id, "Acme");
        const esp = await createOrganizationEspConfig(org.id, {
            name: "Shared SMTP",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "mail@example.com",
        });
        authState.organizationId = org.id;
        authState.organizationScopes = ["esps:manage"];

        const response = await requestApp(
            app(),
            `/organizations/${org.organizationId}/esps/${esp.espId}/test`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ to: "operator@example.com" }),
            },
        );

        expect(response.status).toBe(200);
        expect(espTestMock.testEspConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ espId: esp.espId }),
                to: "operator@example.com",
                account: undefined,
            }),
        );
    });

    it("sets policy as an organization key and grants the default to a newly provisioned team", async () => {
        const owner = await insertUser("Owner");
        const org = await createOrganization(owner.id, "Acme");
        const esp = await createActiveOrganizationEsp(org.id);
        authState.organizationId = org.id;
        authState.organizationScopes = ["delivery:manage"];

        const updated = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    defaultEspId: esp.espId,
                    autoGrantDefaultEsp: true,
                }),
            },
        );
        expect(updated.status).toBe(200);
        expect(updated.json()).toMatchObject({
            defaultEspId: esp.espId,
            autoGrantDefaultEsp: true,
        });
        expect(
            await tdb
                .select()
                .from(organizationApiKeys)
                .where(eq(organizationApiKeys.organizationId, org.id)),
        ).toHaveLength(0);

        const provisioned = await requestApp(app(), "/provisioning/teams", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                externalId: "courselit:school-123",
                name: "School 123",
            }),
        });
        // Team provisioning remains a separate authority from delivery policy.
        expect(provisioned.status).toBe(403);

        authState.organizationScopes = ["delivery:manage", "teams:provision"];
        const created = await requestApp(app(), "/provisioning/teams", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                externalId: "courselit:school-123",
                name: "School 123",
            }),
        });
        expect(created.status).toBe(200);
        expect(created.json()).toMatchObject({
            created: true,
            name: "School 123",
        });

        const [policy] = await tdb
            .select()
            .from(organizationDeliveryPolicies)
            .where(eq(organizationDeliveryPolicies.organizationId, org.id));
        expect(policy.defaultEspConfigId).toBe(esp.id);

        const [team] = await tdb
            .select({ id: teams.id })
            .from(teams)
            .where(eq(teams.teamId, created.json().teamId));
        expect(team).toBeDefined();
        const [teamDelivery] = await tdb
            .select({ settings: teamDeliverySettings })
            .from(teamDeliverySettings)
            .where(eq(teamDeliverySettings.teamId, team.id));
        expect(teamDelivery.settings.defaultSource).toBe("organization");

        const [grant] = await tdb
            .select()
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.teamId, team.id));
        expect(grant).toMatchObject({
            organizationId: org.id,
            espConfigId: esp.id,
            status: "active",
        });

        const audit = await tdb
            .select()
            .from(organizationAuditEvents)
            .where(
                eq(
                    organizationAuditEvents.action,
                    "organization_delivery_policy.updated",
                ),
            );
        expect(audit).toEqual([
            expect.objectContaining({
                actorType: "organization_key",
                actorId: authState.organizationApiKeyId,
            }),
        ]);
    });

    it("keeps owner/admin session access and rejects inactive or foreign ESP defaults", async () => {
        const owner = await insertUser("Owner");
        const org = await createOrganization(owner.id, "Acme");
        const esp = await createActiveOrganizationEsp(org.id);
        const otherOwner = await insertUser("Other");
        const otherOrg = await createOrganization(otherOwner.id, "Other Org");
        const foreignEsp = await createActiveOrganizationEsp(otherOrg.id);

        authState.authKind = "session";
        authState.userId = owner.id;
        authState.organizationId = "";
        authState.organizationScopes = [];
        expect(
            (await requestApp(app(), policyPath(org.organizationId))).status,
        ).toBe(200);
        const ownerUpdate = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ autoGrantDefaultEsp: true }),
            },
        );
        expect(ownerUpdate.status).toBe(200);

        const admin = await insertUser("Admin");
        await tdb.insert(organizationMembers).values({
            organizationId: org.id,
            userId: admin.id,
            role: "admin",
        });
        authState.userId = admin.id;
        expect(
            (await requestApp(app(), policyPath(org.organizationId))).status,
        ).toBe(200);
        const adminUpdate = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ teamEspEnabledByDefault: false }),
            },
        );
        expect(adminUpdate.status).toBe(200);

        authState.authKind = "organization_key";
        authState.organizationId = org.id;
        authState.organizationScopes = ["delivery:manage"];
        const foreignUpdate = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ defaultEspId: foreignEsp.espId }),
            },
        );
        expect(foreignUpdate.status).toBe(422);

        await tdb
            .update(espConfigs)
            .set({ status: "draft" })
            .where(eq(espConfigs.id, esp.id));
        const inactiveUpdate = await requestApp(
            app(),
            policyPath(org.organizationId),
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ defaultEspId: esp.espId }),
            },
        );
        expect(inactiveUpdate.status).toBe(422);
    });
});
