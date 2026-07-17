import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import {
    emailDeliveryEvents,
    emailSuppressions,
    espConfigs,
    espWebhookReceipts,
    outboundMessages,
} from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { upsertFeedbackConnection } from "./feedback-connection-queries";
import { createWebhookReceipt } from "./webhook-receipt-queries";
import { createOutboundMessage } from "./outbound-queries";
import { addOrStrengthenSuppression } from "./suppression-queries";
import {
    anonymizeRecipientForPrivacyDeletion,
    purgeExpiredRawReceipts,
    purgeOldDeliveryEvents,
} from "./retention";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("retention (integration)", () => {
    it("purges raw receipt payloads older than 30 days but keeps metadata", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const connection = await upsertFeedbackConnection({
            teamId: team.id,
            espConfigId: esp.id,
            provider: "postmark",
            credential: "secret",
        });

        const old = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "postmark",
            providerRequestId: null,
            rawBody: Buffer.from("{}"),
            safeHeaders: { "content-type": "application/json" },
        });
        await tdb
            .update(espWebhookReceipts)
            .set({
                receivedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
            })
            .where(eq(espWebhookReceipts.id, old.id));

        const recent = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "postmark",
            providerRequestId: null,
            rawBody: Buffer.from("{}"),
            safeHeaders: {},
        });

        const purged = await purgeExpiredRawReceipts();
        expect(purged).toBe(1);

        const [oldAfter] = await tdb
            .select()
            .from(espWebhookReceipts)
            .where(eq(espWebhookReceipts.id, old.id));
        expect(oldAfter.encryptedPayload).toBeNull();
        expect(oldAfter.id).toBe(old.id); // metadata row itself remains

        const [recentAfter] = await tdb
            .select()
            .from(espWebhookReceipts)
            .where(eq(espWebhookReceipts.id, recent.id));
        expect(recentAfter.encryptedPayload).toBeTruthy();
    });

    it("purges delivery events older than 13 months", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const connection = await upsertFeedbackConnection({
            teamId: team.id,
            espConfigId: esp.id,
            provider: "postmark",
            credential: "secret",
        });
        const receipt = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "postmark",
            providerRequestId: null,
            rawBody: Buffer.from("{}"),
            safeHeaders: {},
        });

        const [oldEvent] = await tdb
            .insert(emailDeliveryEvents)
            .values({
                receiptId: receipt.id,
                connectionId: connection.id,
                teamId: team.id,
                provider: "postmark",
                providerEventKey: "old-1",
                eventType: "delivered",
                occurredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
                receivedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
            })
            .returning();
        const [recentEvent] = await tdb
            .insert(emailDeliveryEvents)
            .values({
                receiptId: receipt.id,
                connectionId: connection.id,
                teamId: team.id,
                provider: "postmark",
                providerEventKey: "recent-1",
                eventType: "delivered",
                occurredAt: new Date(),
                receivedAt: new Date(),
            })
            .returning();

        const purged = await purgeOldDeliveryEvents();
        expect(purged).toBe(1);

        const remaining = await tdb.select().from(emailDeliveryEvents);
        expect(remaining.map((r) => r.id)).toEqual([recentEvent.id]);
        expect(remaining.map((r) => r.id)).not.toContain(oldEvent.id);
    });

    it("anonymizes a recipient's address across tables while keeping the suppression hash", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const connection = await upsertFeedbackConnection({
            teamId: team.id,
            espConfigId: esp.id,
            provider: "postmark",
            credential: "secret",
        });
        const recipient = "erase-me@example.com";

        const outbound = await createOutboundMessage({
            teamId: team.id,
            deliveryRoute: "custom",
            espConfigId: esp.id,
            feedbackConnectionId: connection.id,
            sourceType: "transactional",
            recipientEmail: recipient,
            normalizedRecipient: recipient,
            provider: "postmark",
            rfcMessageId: "erase@sendlit.test",
        });
        const receipt = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "postmark",
            providerRequestId: null,
            rawBody: Buffer.from("{}"),
            safeHeaders: {},
        });
        await tdb.insert(emailDeliveryEvents).values({
            receiptId: receipt.id,
            connectionId: connection.id,
            teamId: team.id,
            outboundMessageId: outbound.id,
            provider: "postmark",
            providerEventKey: "e-1",
            recipientEmail: recipient,
            normalizedRecipient: recipient,
            eventType: "hard_bounce",
            occurredAt: new Date(),
            receivedAt: new Date(),
        });
        const suppression = await addOrStrengthenSuppression({
            teamId: team.id,
            recipientEmail: recipient,
            reason: "hard_bounce",
            actorType: "system",
        });

        await anonymizeRecipientForPrivacyDeletion({
            teamId: team.id,
            normalizedRecipient: recipient,
        });

        const [outboundAfter] = await tdb
            .select()
            .from(outboundMessages)
            .where(eq(outboundMessages.id, outbound.id));
        expect(outboundAfter.recipientEmail).toBe("");
        expect(outboundAfter.normalizedRecipient).toBe("");

        const [eventAfter] = await tdb
            .select()
            .from(emailDeliveryEvents)
            .where(eq(emailDeliveryEvents.outboundMessageId, outbound.id));
        expect(eventAfter.recipientEmail).toBeNull();

        const [suppressionAfter] = await tdb
            .select()
            .from(emailSuppressions)
            .where(eq(emailSuppressions.id, suppression.id));
        expect(suppressionAfter.recipientEmail).toBeNull();
        expect(suppressionAfter.normalizedRecipient).toBeNull();
        // The do-not-send state itself must survive the erasure.
        expect(suppressionAfter.active).toBe(true);
        expect(suppressionAfter.recipientHash).toBe(suppression.recipientHash);
    });
});
