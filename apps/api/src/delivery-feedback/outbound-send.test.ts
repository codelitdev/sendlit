import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { espConfigs, outboundMessages } from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { createCustomRouteOutboundMessage } from "./outbound-send";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("outbound submission idempotency", () => {
    it("reuses the ledger row and RFC Message-ID across a campaign retry", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const input = {
            teamId: team.id,
            espConfigId: esp.id,
            provider: esp.provider,
            sourceType: "campaign" as const,
            submissionKey: "campaign:ongoing-1:email-1",
            recipientEmail: "reader@example.com",
            normalizedRecipient: "reader@example.com",
        };

        const first = await createCustomRouteOutboundMessage(input);
        const retry = await createCustomRouteOutboundMessage(input);

        expect(retry.outbound.id).toBe(first.outbound.id);
        expect(retry.rfcMessageId).toBe(first.rfcMessageId);
        expect(
            await tdb
                .select()
                .from(outboundMessages)
                .where(eq(outboundMessages.submissionKey, input.submissionKey)),
        ).toHaveLength(1);
    });

    it("does not share ledger rows between distinct submissions", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const base = {
            teamId: team.id,
            espConfigId: esp.id,
            provider: esp.provider,
            sourceType: "campaign" as const,
            recipientEmail: "reader@example.com",
            normalizedRecipient: "reader@example.com",
        };

        const first = await createCustomRouteOutboundMessage({
            ...base,
            submissionKey: "campaign:ongoing-1:email-1",
        });
        const second = await createCustomRouteOutboundMessage({
            ...base,
            submissionKey: "campaign:ongoing-1:email-2",
        });

        expect(second.outbound.id).not.toBe(first.outbound.id);
        expect(second.rfcMessageId).not.toBe(first.rfcMessageId);
    });
});
