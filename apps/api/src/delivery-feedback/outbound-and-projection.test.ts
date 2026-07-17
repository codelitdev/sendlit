import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import {
    emailDeliveryEvents,
    espConfigs,
    espFeedbackConnections,
    espWebhookReceipts,
    outboundMessages,
} from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { encryptSecret } from "../utils/secret-crypto";
import { correlateOutboundMessage } from "./correlation";
import {
    insertCanonicalEventIfNew,
    linkEventToOutboundMessage,
} from "./delivery-event-queries";
import { applyEventToProjection } from "./projection";
import {
    createOutboundMessage,
    getOutboundMessageById,
    markOutboundAccepted,
    markOutboundBounced,
    markOutboundFailed,
} from "./outbound-queries";
import { computeFinalSoftBounceStreak } from "./soft-bounce-streak";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

async function seedConnectionAndOutbound(
    overrides: {
        providerMessageId?: string | null;
        recipient?: string;
        deliveryStatus?: string;
    } = {},
) {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, team.id));

    const [connection] = await tdb
        .insert(espFeedbackConnections)
        .values({
            teamId: team.id,
            espConfigId: esp.id,
            scope: "custom",
            provider: "postmark",
            encryptedCredentials: encryptSecret("webhook-secret"),
            status: "healthy",
        })
        .returning();

    const recipient = overrides.recipient ?? "ada@example.com";
    let outbound = await createOutboundMessage({
        teamId: team.id,
        deliveryRoute: "custom",
        espConfigId: esp.id,
        feedbackConnectionId: connection.id,
        sourceType: "transactional",
        recipientEmail: recipient,
        normalizedRecipient: recipient.toLowerCase(),
        provider: "postmark",
        rfcMessageId: `${crypto.randomUUID()}@sendlit.test`,
    });

    if (overrides.providerMessageId) {
        await markOutboundAccepted(outbound.id, {
            providerMessageId: overrides.providerMessageId,
        });
        outbound = (await getOutboundMessageById(outbound.id))!;
    }

    if (overrides.deliveryStatus && overrides.deliveryStatus !== "queued") {
        await tdb
            .update(outboundMessages)
            .set({ deliveryStatus: overrides.deliveryStatus })
            .where(eq(outboundMessages.id, outbound.id));
        outbound = (await getOutboundMessageById(outbound.id))!;
    }

    return { team, esp, connection, outbound };
}

async function seedEvent({
    teamId,
    connectionId,
    outboundMessageId,
    eventType,
    normalizedRecipient,
    occurredAt,
    providerEventKey,
}: {
    teamId: string;
    connectionId: string;
    outboundMessageId: string;
    eventType: string;
    normalizedRecipient: string;
    occurredAt: Date;
    providerEventKey: string;
}) {
    const [receipt] = await tdb
        .insert(espWebhookReceipts)
        .values({
            connectionId,
            teamId,
            provider: "postmark",
            bodySha256: "abc",
            status: "processed",
        })
        .returning();

    const [event] = await tdb
        .insert(emailDeliveryEvents)
        .values({
            receiptId: receipt.id,
            connectionId,
            teamId,
            outboundMessageId,
            provider: "postmark",
            providerEventKey,
            normalizedRecipient,
            eventType,
            occurredAt,
            receivedAt: occurredAt,
        })
        .returning();
    return event;
}

describe("outbound ledger + delivery projection (integration)", () => {
    it("records accepted / failed / bounced transport outcomes", async () => {
        const { outbound } = await seedConnectionAndOutbound();

        await markOutboundAccepted(outbound.id, {
            providerMessageId: "pm-msg-1",
        });
        let row = await getOutboundMessageById(outbound.id);
        expect(row).toMatchObject({
            deliveryStatus: "accepted",
            providerMessageId: "pm-msg-1",
        });

        // Accepted only transitions from queued — second call is a no-op.
        await markOutboundAccepted(outbound.id, {
            providerMessageId: "pm-msg-2",
        });
        row = await getOutboundMessageById(outbound.id);
        expect(row?.providerMessageId).toBe("pm-msg-1");

        const { outbound: failedOut } = await seedConnectionAndOutbound();
        await markOutboundFailed(failedOut.id);
        expect(
            (await getOutboundMessageById(failedOut.id))?.deliveryStatus,
        ).toBe("failed");

        const { outbound: bounceOut } = await seedConnectionAndOutbound({
            providerMessageId: "pm-bounce",
        });
        await markOutboundBounced(bounceOut.id);
        expect(
            (await getOutboundMessageById(bounceOut.id))?.deliveryStatus,
        ).toBe("bounced");
    });

    it("projects events without regressing terminal delivery status", async () => {
        const { outbound } = await seedConnectionAndOutbound();

        await applyEventToProjection(outbound.id, "accepted", new Date());
        expect(
            (await getOutboundMessageById(outbound.id))?.deliveryStatus,
        ).toBe("accepted");

        await applyEventToProjection(outbound.id, "delivered", new Date());
        let row = await getOutboundMessageById(outbound.id);
        expect(row?.deliveryStatus).toBe("delivered");
        expect(row?.deliveredAt).toBeTruthy();

        // Bounce may follow delivered.
        await applyEventToProjection(outbound.id, "hard_bounce", new Date());
        row = await getOutboundMessageById(outbound.id);
        expect(row?.deliveryStatus).toBe("bounced");

        // Accepted/delivered must not unwind a bounce.
        await applyEventToProjection(outbound.id, "delivered", new Date());
        await applyEventToProjection(outbound.id, "accepted", new Date());
        expect(
            (await getOutboundMessageById(outbound.id))?.deliveryStatus,
        ).toBe("bounced");

        // Complaint is independent of delivery_status.
        await applyEventToProjection(outbound.id, "complaint", new Date());
        row = await getOutboundMessageById(outbound.id);
        expect(row?.feedbackStatus).toBe("complained");
        expect(row?.deliveryStatus).toBe("bounced");
    });

    it("correlates by provider message id, then recipient window", async () => {
        const a = await seedConnectionAndOutbound({
            providerMessageId: "provider-abc",
            recipient: "ada@example.com",
        });
        const b = await seedConnectionAndOutbound({
            recipient: "other@example.com",
        });
        // Same connection as `a` for recipient-window tier: create another
        // outbound under a's connection.
        const sibling = await createOutboundMessage({
            teamId: a.team.id,
            deliveryRoute: "custom",
            espConfigId: a.esp.id,
            feedbackConnectionId: a.connection.id,
            sourceType: "transactional",
            recipientEmail: "ada@example.com",
            normalizedRecipient: "ada@example.com",
            provider: "postmark",
            rfcMessageId: `${crypto.randomUUID()}@sendlit.test`,
        });

        const byProviderId = await correlateOutboundMessage({
            connectionId: a.connection.id,
            providerMessageId: "provider-abc",
        });
        expect(byProviderId?.id).toBe(a.outbound.id);

        const byRecipient = await correlateOutboundMessage({
            connectionId: a.connection.id,
            recipientEmail: "ADA@Example.com",
        });
        // Newest matching recipient within the window.
        expect(byRecipient?.id).toBe(sibling.id);

        // Cross-connection isolation.
        expect(
            await correlateOutboundMessage({
                connectionId: b.connection.id,
                providerMessageId: "provider-abc",
            }),
        ).toBeNull();
    });

    it("counts consecutive final soft bounces and resets on delivered", async () => {
        const { team, connection, outbound } = await seedConnectionAndOutbound({
            recipient: "soft@example.com",
        });
        const recipient = "soft@example.com";

        // Three soft bounces on distinct messages → streak 3.
        const messages = [outbound];
        for (let i = 0; i < 2; i++) {
            messages.push(
                await createOutboundMessage({
                    teamId: team.id,
                    deliveryRoute: "custom",
                    espConfigId: outbound.espConfigId,
                    feedbackConnectionId: connection.id,
                    sourceType: "transactional",
                    recipientEmail: recipient,
                    normalizedRecipient: recipient,
                    provider: "postmark",
                    rfcMessageId: `${crypto.randomUUID()}@sendlit.test`,
                }),
            );
        }

        const base = Date.now();
        for (let i = 0; i < messages.length; i++) {
            await seedEvent({
                teamId: team.id,
                connectionId: connection.id,
                outboundMessageId: messages[i]!.id,
                eventType: "soft_bounce",
                normalizedRecipient: recipient,
                occurredAt: new Date(base + i * 1000),
                providerEventKey: `soft-${i}`,
            });
        }
        expect(await computeFinalSoftBounceStreak(team.id, recipient)).toBe(3);

        // A newer delivered on a fourth message resets the streak.
        const deliveredMsg = await createOutboundMessage({
            teamId: team.id,
            deliveryRoute: "custom",
            espConfigId: outbound.espConfigId,
            feedbackConnectionId: connection.id,
            sourceType: "transactional",
            recipientEmail: recipient,
            normalizedRecipient: recipient,
            provider: "postmark",
            rfcMessageId: `${crypto.randomUUID()}@sendlit.test`,
        });
        await seedEvent({
            teamId: team.id,
            connectionId: connection.id,
            outboundMessageId: deliveredMsg.id,
            eventType: "delivered",
            normalizedRecipient: recipient,
            occurredAt: new Date(base + 10_000),
            providerEventKey: "delivered-1",
        });
        expect(await computeFinalSoftBounceStreak(team.id, recipient)).toBe(0);
    });

    it("inserts canonical events idempotently by provider event key", async () => {
        const { team, connection, outbound } =
            await seedConnectionAndOutbound();
        const [receipt] = await tdb
            .insert(espWebhookReceipts)
            .values({
                connectionId: connection.id,
                teamId: team.id,
                provider: "postmark",
                bodySha256: "deadbeef",
                status: "processing",
            })
            .returning();

        const input = {
            connectionId: connection.id,
            receiptId: receipt.id,
            teamId: team.id,
            provider: "postmark",
            providerEventKey: "Bounce:42",
            providerMessageId: "pm-1",
            recipientEmail: "ada@example.com",
            normalizedRecipient: "ada@example.com",
            eventType: "hard_bounce" as const,
            bounceClass: "permanent" as const,
            smtpCode: null,
            enhancedStatusCode: null,
            reason: "user unknown",
            remoteMta: null,
            occurredAt: new Date(),
            receivedAt: new Date(),
            metadata: {},
        };

        const first = await insertCanonicalEventIfNew(input);
        const second = await insertCanonicalEventIfNew(input);
        expect(first).not.toBeNull();
        expect(second).toBeNull();

        await linkEventToOutboundMessage(first!.id, outbound.id, team.id);
        const linked = await tdb
            .select()
            .from(emailDeliveryEvents)
            .where(eq(emailDeliveryEvents.id, first!.id));
        expect(linked[0]?.outboundMessageId).toBe(outbound.id);
    });
});
