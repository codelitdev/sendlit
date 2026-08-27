import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../../db/client";
import {
    outboundMessages,
    sequences,
    teamDeliverySettings,
} from "../../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../../test/db";
import { seedSequence } from "../../test/fixtures";
import {
    createEspConfig,
    deleteEspConfig,
    getDecryptedEspCredentials,
    getEspConfigByEspId,
    listEspConfigs,
    recordEspTestResult,
    upsertEspConfig,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("ESP config queries", () => {
    it("stores multiple team-owned configurations", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const second = await createEspConfig(team.id, {
            name: "Transactional",
            provider: "smtp",
            host: "transactional.example.com",
            port: 587,
            secure: false,
        });

        const configs = await listEspConfigs(team.id);
        expect(configs).toHaveLength(2);
        expect(second.espId).toMatch(/^esp_/);
        expect(configs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    espId: second.espId,
                    ownerScope: "team",
                }),
            ]),
        );
    });

    it("encrypts, preserves, and clears SMTP passwords", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const initial = await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "user",
            password: "first-secret",
            fromName: "Sender",
            fromEmail: "sender@example.com",
        });
        expect(initial.encryptedSecret).not.toContain("first-secret");
        await expect(
            getDecryptedEspCredentials(team.id),
        ).resolves.toMatchObject({
            password: "first-secret",
            username: "user",
        });

        await upsertEspConfig(team.id, {
            provider: "smtp",
            host: "smtp2.example.com",
            port: 465,
            secure: true,
            password: "",
        });
        await expect(
            getDecryptedEspCredentials(team.id),
        ).resolves.toMatchObject({
            password: undefined,
            host: "smtp2.example.com",
        });
    });

    it("records a test result and deletes an unused draft", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const draft = await createEspConfig(team.id, {
            name: "Draft",
            provider: "smtp",
            host: "draft.example.com",
            port: 587,
            secure: false,
        });
        await recordEspTestResult(
            team.id,
            "failed",
            "Bad credentials",
            draft.espId,
        );
        await expect(
            getEspConfigByEspId(team.id, draft.espId),
        ).resolves.toMatchObject({
            lastTestStatus: "failed",
            lastTestError: "Bad credentials",
        });
        await expect(deleteEspConfig(team.id, draft.espId)).resolves.toBe(true);
        await expect(
            getEspConfigByEspId(team.id, draft.espId),
        ).resolves.toBeNull();
    });

    it("deletes an unused active default and clears its delivery selection", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [active] = await listEspConfigs(team.id);

        await expect(deleteEspConfig(team.id, active.espId)).resolves.toBe(
            true,
        );
        await expect(
            getEspConfigByEspId(team.id, active.espId),
        ).resolves.toBeNull();

        const [delivery] = await tdb
            .select()
            .from(teamDeliverySettings)
            .where(eq(teamDeliverySettings.teamId, team.id));
        expect(delivery).toMatchObject({
            defaultSource: null,
            defaultTeamEspConfigId: null,
        });
    });

    it("deletes an ESP pinned only to draft, paused, or completed sequences", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [active] = await listEspConfigs(team.id);
        const draft = await seedSequence(tdb, {
            teamId: team.id,
            status: "draft",
            outboxId: active.id,
            emails: [{ emailId: "email_draft" }],
        });
        const paused = await seedSequence(tdb, {
            teamId: team.id,
            status: "paused",
            outboxId: active.id,
            emails: [{ emailId: "email_paused" }],
        });
        const completed = await seedSequence(tdb, {
            teamId: team.id,
            type: "broadcast",
            status: "completed",
            outboxId: active.id,
            emails: [{ emailId: "email_completed" }],
        });
        const [terminalOutbound] = await tdb
            .insert(outboundMessages)
            .values({
                teamId: team.id,
                deliverySourceType: "team",
                espConfigId: active.id,
                espGrantId: null,
                sourceType: "campaign",
                recipientEmail: "recipient@example.com",
                normalizedRecipient: "recipient@example.com",
                provider: "smtp",
                rfcMessageId: "<completed@example.com>",
                deliveryStatus: "accepted",
            })
            .returning();

        await expect(deleteEspConfig(team.id, active.espId)).resolves.toBe(
            true,
        );

        const detached = await tdb
            .select({
                status: sequences.status,
                deliverySourceIntent: sequences.deliverySourceIntent,
                deliverySourceType: sequences.deliverySourceType,
                outboxId: sequences.outboxId,
                espGrantId: sequences.espGrantId,
                report: sequences.report,
            })
            .from(sequences)
            .where(
                inArray(sequences.id, [
                    draft.sequenceRow.id,
                    paused.sequenceRow.id,
                    completed.sequenceRow.id,
                ]),
            );
        expect(detached).toHaveLength(3);
        expect(detached).toEqual(
            expect.arrayContaining([
                ...["draft", "paused", "completed"].map((status) =>
                    expect.objectContaining({
                        status,
                        deliverySourceIntent: null,
                        deliverySourceType: null,
                        outboxId: null,
                        espGrantId: null,
                        report: expect.objectContaining({
                            deliverySourceDeleted: true,
                        }),
                    }),
                ),
            ]),
        );
        const [historicalOutbound] = await tdb
            .select({
                espConfigId: outboundMessages.espConfigId,
                espGrantId: outboundMessages.espGrantId,
                provider: outboundMessages.provider,
                deliveryStatus: outboundMessages.deliveryStatus,
            })
            .from(outboundMessages)
            .where(eq(outboundMessages.id, terminalOutbound.id));
        expect(historicalOutbound).toEqual({
            espConfigId: null,
            espGrantId: null,
            provider: "smtp",
            deliveryStatus: "accepted",
        });
    });

    it("scopes ESP lookups and deletes to the owning team", async () => {
        const { team: teamA } = await seedTeamAndContact(tdb);
        const { team: teamB } = await seedTeamAndContact(tdb);
        const [espA] = await listEspConfigs(teamA.id);

        await expect(
            getEspConfigByEspId(teamB.id, espA.espId),
        ).resolves.toBeNull();
        await expect(deleteEspConfig(teamB.id, espA.espId)).resolves.toBe(
            false,
        );
    });
});
