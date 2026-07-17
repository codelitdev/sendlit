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
    outboundMessages,
} from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { upsertFeedbackConnection } from "./feedback-connection-queries";
import { createWebhookReceipt } from "./webhook-receipt-queries";
import {
    createOutboundMessage,
    getOutboundMessageById,
} from "./outbound-queries";
import { processWebhookReceipt } from "./process-receipt";
import { isRecipientSuppressed } from "./suppression-queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("processWebhookReceipt (integration)", () => {
    it("normalizes a Postmark hard bounce into a canonical event, projection update, and suppression", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));

        const connection = await upsertFeedbackConnection({
            teamId: team.id,
            espConfigId: esp.id,
            provider: "postmark",
            credential: "hook-secret",
        });

        const outbound = await createOutboundMessage({
            teamId: team.id,
            deliveryRoute: "custom",
            espConfigId: esp.id,
            feedbackConnectionId: connection.id,
            sourceType: "transactional",
            recipientEmail: "bounce@example.com",
            normalizedRecipient: "bounce@example.com",
            provider: "postmark",
            rfcMessageId: "abc123@sendlit.test",
        });
        // Simulate the transport response the worker would have captured —
        // some providers' SMTP relays echo their own id here.
        await tdb
            .update(outboundMessages)
            .set({ providerMessageId: "pm-message-1" })
            .where(eq(outboundMessages.id, outbound.id));

        const rawBody = Buffer.from(
            JSON.stringify({
                RecordType: "Bounce",
                Type: "HardBounce",
                ID: 555,
                MessageID: "pm-message-1",
                Email: "bounce@example.com",
                Description: "user unknown",
                BouncedAt: "2024-01-01T00:00:00Z",
            }),
            "utf8",
        );
        const receipt = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "postmark",
            providerRequestId: null,
            rawBody,
            safeHeaders: {},
        });

        await processWebhookReceipt(receipt.id);

        const events = await tdb
            .select()
            .from(emailDeliveryEvents)
            .where(eq(emailDeliveryEvents.receiptId, receipt.id));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            eventType: "hard_bounce",
            bounceClass: "permanent",
            outboundMessageId: outbound.id,
        });

        const projected = await getOutboundMessageById(outbound.id);
        expect(projected?.deliveryStatus).toBe("bounced");
        expect(projected?.bouncedAt).toBeTruthy();

        expect(await isRecipientSuppressed(team.id, "bounce@example.com")).toBe(
            true,
        );

        // Replaying the same receipt is a no-op — it was already claimed,
        // so a second call must not double-create the event or suppression.
        await processWebhookReceipt(receipt.id);
        const eventsAfterReplay = await tdb
            .select()
            .from(emailDeliveryEvents)
            .where(eq(emailDeliveryEvents.receiptId, receipt.id));
        expect(eventsAfterReplay).toHaveLength(1);
    });

    it("does not suppress on an unknown event type or unmatched recipient", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const [esp] = await tdb
            .select()
            .from(espConfigs)
            .where(eq(espConfigs.teamId, team.id));
        const connection = await upsertFeedbackConnection({
            teamId: team.id,
            espConfigId: esp.id,
            provider: "resend",
            credential: "whsec_test",
        });

        const rawBody = Buffer.from(
            JSON.stringify({
                type: "email.opened",
                data: { email_id: "re_1", to: ["nobody@example.com"] },
            }),
            "utf8",
        );
        const receipt = await createWebhookReceipt({
            connectionId: connection.id,
            teamId: team.id,
            provider: "resend",
            providerRequestId: "svix-1",
            rawBody,
            safeHeaders: {},
        });

        await processWebhookReceipt(receipt.id);

        expect(await isRecipientSuppressed(team.id, "nobody@example.com")).toBe(
            false,
        );
        const events = await tdb
            .select()
            .from(emailDeliveryEvents)
            .where(eq(emailDeliveryEvents.receiptId, receipt.id));
        // "unknown" events are stored (for operator visibility) but never
        // linked/suppressed.
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe("unknown");
        expect(events[0].outboundMessageId).toBeNull();
    });
});
