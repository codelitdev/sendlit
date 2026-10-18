import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
    retrieveSubscription: vi.fn(),
    parseWebhook: vi.fn(),
}));

vi.mock("../../db/client", async () => {
    const { makeTestDb } = await import("../../test/db.js");
    return { db: await makeTestDb() };
});

vi.mock("../provider-registry", () => ({
    getBillingProvider: () => ({
        provider: "dodo",
        retrieveSubscription: providerMocks.retrieveSubscription,
        parseWebhook: providerMocks.parseWebhook,
    }),
}));

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { billingWebhookEvents } from "../../db/schema";
import { truncateAll, type TestDb } from "../../test/db";
import { encryptBillingValue } from "../crypto";
import { BillingProviderError } from "../provider";
import {
    claimBillingWebhookEvent,
    processBillingWebhookInboxEvent,
} from "./processor";

const tdb = db as unknown as TestDb;
const originalEncryptionKey = process.env.BILLING_DATA_ENCRYPTION_KEY;

beforeEach(async () => {
    process.env.BILLING_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
        "base64",
    );
    providerMocks.retrieveSubscription.mockReset();
    providerMocks.parseWebhook.mockReset();
    await truncateAll(tdb);
});

afterEach(() => {
    if (originalEncryptionKey === undefined) {
        delete process.env.BILLING_DATA_ENCRYPTION_KEY;
    } else {
        process.env.BILLING_DATA_ENCRYPTION_KEY = originalEncryptionKey;
    }
});

describe("durable billing webhook inbox", () => {
    it("keeps a verified event for retry when provider retrieval is unavailable", async () => {
        const [stored] = await tdb
            .insert(billingWebhookEvents)
            .values({
                provider: "dodo",
                providerEventId: "evt_retry",
                eventType: "subscription.updated",
                occurredAt: new Date("2026-08-29T00:00:00.000Z"),
                payloadEncrypted: encryptBillingValue(
                    JSON.stringify({
                        body: "{}",
                        headers: {},
                        canonical: {
                            provider: "dodo",
                            providerEventId: "evt_retry",
                            eventType: "subscription.updated",
                            occurredAt: "2026-08-29T00:00:00.000Z",
                            subscriptionId: "sub_provider",
                        },
                    }),
                ),
                payloadKeyVersion: "v1",
                status: "pending",
            })
            .returning({ id: billingWebhookEvents.id });
        providerMocks.retrieveSubscription.mockRejectedValue(
            new BillingProviderError("unavailable", "dodo_down"),
        );

        expect(await claimBillingWebhookEvent(stored.id)).toBe(true);
        await processBillingWebhookInboxEvent(stored.id);

        const [row] = await tdb
            .select()
            .from(billingWebhookEvents)
            .where(eq(billingWebhookEvents.id, stored.id));
        expect(row.status).toBe("failed");
        expect(row.lastError).toBe("provider_unavailable");
        expect(row.processedAt).toBeNull();
        expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    });
});
