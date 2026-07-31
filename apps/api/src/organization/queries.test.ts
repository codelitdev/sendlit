import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { eq } from "drizzle-orm";
import {
    espConfigTeamGrants,
    espConfigs,
    organizationEspQuotaReservations,
    organizationEspUsageBuckets,
    outboundMessages,
    user,
} from "../db/schema";
import {
    addOrganizationMemberByEmail,
    getOrganizationMembership,
    listOrganizationsForUser,
    createOrganization,
} from "./queries";
import { createTeam } from "../team/queries";
import {
    getTeamDeliverySettingView,
    resolveDeliverySource,
    transitionEspGrant,
    upsertEspGrant,
} from "../delivery/queries";
import { createOrganizationEspConfig } from "../settings/esp/queries";
import { reserveOrganizationQuotaForOutbound } from "../delivery/quota";
import { getOrganizationQuotaUsage } from "../delivery/quota";
import { listOrganizationAuditEvents } from "./audit";
import { truncateAll, type TestDb } from "../test/db";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("organizations", () => {
    it("owns teams through a Better Auth user membership", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });

        expect(
            await getOrganizationMembership(organization.id, member.id),
        ).toMatchObject({ role: "owner" });
        expect(await listOrganizationsForUser(member.id)).toEqual([
            expect.objectContaining({ id: organization.id }),
        ]);
        expect(team.organizationId).toBe(organization.id);
    });

    it("adds an existing Better Auth user by normalized email", async () => {
        const [owner, member] = await tdb
            .insert(user)
            .values([
                {
                    id: crypto.randomUUID(),
                    name: "Owner",
                    email: `owner-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: crypto.randomUUID(),
                    name: "Member",
                    email: `member-${crypto.randomUUID()}@example.com`,
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ])
            .returning();
        const organization = await createOrganization(owner.id, "Acme");

        await expect(
            addOrganizationMemberByEmail(
                organization.id,
                member.email.toUpperCase(),
                "member",
            ),
        ).resolves.toMatchObject({ userId: member.id, email: member.email });
        await expect(
            addOrganizationMemberByEmail(
                organization.id,
                "missing@example.com",
                "member",
            ),
        ).resolves.toBeNull();
    });

    it("allows a team to pin an organization-owned ESP without exposing it as a team ESP", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });
        const esp = await createOrganizationEspConfig(organization.id, {
            name: "Shared SMTP",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "no-reply@example.com",
        });
        await tdb
            .update(espConfigs)
            .set({ status: "active", activatedAt: new Date() })
            .where(eq(espConfigs.id, esp.id));
        await upsertEspGrant(
            organization.id,
            team.id,
            { espId: esp.espId, dailyLimit: 10, monthlyLimit: 100 },
            { type: "user", id: member.id },
        );

        await expect(
            resolveDeliverySource(team.id, { type: "organization" }),
        ).resolves.toMatchObject({
            type: "organization",
            espConfigId: esp.id,
            fromEmail: "no-reply@example.com",
        });

        const [grantBeforeCancel] = await tdb
            .select()
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.teamId, team.id));
        const [outbound] = await tdb
            .insert(outboundMessages)
            .values({
                teamId: team.id,
                deliverySourceType: "organization",
                espConfigId: esp.id,
                espGrantId: grantBeforeCancel.id,
                sourceType: "campaign",
                submissionKey: `test-${crypto.randomUUID()}`,
                recipientEmail: "student@example.com",
                normalizedRecipient: "student@example.com",
                provider: "smtp",
                rfcMessageId: `<${crypto.randomUUID()}@example.com>`,
            })
            .returning();
        await reserveOrganizationQuotaForOutbound({
            outboundMessageId: outbound.id,
            grantId: grantBeforeCancel.id,
        });
        await expect(
            getOrganizationQuotaUsage(organization.id),
        ).resolves.toMatchObject({
            day: { accepted: 0, reserved: 1 },
            month: { accepted: 0, reserved: 1 },
        });

        await transitionEspGrant(
            organization.id,
            team.id,
            "cancel",
            undefined,
            { type: "user", id: member.id },
        );
        const [grant] = await tdb
            .select()
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.teamId, team.id));
        expect(grant.status).toBe("revoked");
        const [reservation] = await tdb
            .select()
            .from(organizationEspQuotaReservations)
            .where(
                eq(
                    organizationEspQuotaReservations.outboundMessageId,
                    outbound.id,
                ),
            );
        expect(reservation.state).toBe("released");
        const buckets = await tdb
            .select()
            .from(organizationEspUsageBuckets)
            .where(eq(organizationEspUsageBuckets.grantId, grant.id));
        expect(buckets.every((bucket) => bucket.reservedCount === 0)).toBe(
            true,
        );
        await expect(
            resolveDeliverySource(team.id, { type: "organization" }),
        ).rejects.toThrow("organization_delivery_disabled");
        await expect(
            listOrganizationAuditEvents(organization.id),
        ).resolves.toContainEqual(
            expect.objectContaining({
                action: "delivery_grant.cancel",
                teamId: team.teamId,
                espId: esp.espId,
                grantId: grant.grantId,
                actorType: "user",
            }),
        );
    });

    it("lets an organization grant select the shared ESP as the team default", async () => {
        const [member] = await tdb
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name: "Owner",
                email: `owner-${crypto.randomUUID()}@example.com`,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        const organization = await createOrganization(member.id, "Acme");
        const team = await createTeam({
            organizationId: organization.id,
            creatorUserId: member.id,
            name: "School A",
        });
        const esp = await createOrganizationEspConfig(organization.id, {
            name: "Shared SMTP",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            fromEmail: "no-reply@example.com",
        });
        await tdb
            .update(espConfigs)
            .set({ status: "active", activatedAt: new Date() })
            .where(eq(espConfigs.id, esp.id));

        await upsertEspGrant(
            organization.id,
            team.id,
            { espId: esp.espId, makeDefault: true },
            { type: "user", id: member.id },
        );

        await expect(
            getTeamDeliverySettingView(team.id),
        ).resolves.toMatchObject({
            setting: { defaultSource: "organization" },
            defaultTeamEspId: null,
        });
        await expect(resolveDeliverySource(team.id)).resolves.toMatchObject({
            type: "organization",
            espConfigId: esp.id,
        });
    });
});
