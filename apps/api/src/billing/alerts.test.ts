import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { billingCatalogRevisions, billingWebhookEvents } from "../db/schema";
import { truncateAll, type TestDb } from "../test/db";
import {
    collectBillingSloAlerts,
    recordBillingHourlySuccess,
    recordWebhookSignatureFailure,
    resetBillingAlertsForTests,
} from "./alerts";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    resetBillingAlertsForTests();
    recordBillingHourlySuccess();
    await truncateAll(tdb);
});

describe("billing SLO alerts", () => {
    it("pages when a webhook is quarantined", async () => {
        await tdb.insert(billingWebhookEvents).values({
            provider: "fake",
            providerEventId: "evt_quarantine",
            eventType: "subscription.updated",
            occurredAt: new Date(),
            status: "quarantined",
        });
        const alerts = await collectBillingSloAlerts();
        expect(alerts.map((alert) => alert.code)).toContain(
            "webhook_quarantined",
        );
    });

    it("pages when inbox lag exceeds five minutes", async () => {
        await tdb.insert(billingWebhookEvents).values({
            provider: "fake",
            providerEventId: "evt_lag",
            eventType: "subscription.updated",
            occurredAt: new Date("2026-08-01T00:00:00.000Z"),
            receivedAt: new Date("2026-08-01T00:00:00.000Z"),
            status: "pending",
        });
        const alerts = await collectBillingSloAlerts(
            new Date("2026-08-01T00:10:00.000Z"),
        );
        expect(alerts.map((alert) => alert.code)).toContain(
            "webhook_inbox_lag",
        );
    });

    it("pages when the catalog is invalid", async () => {
        await tdb.insert(billingCatalogRevisions).values({
            revision: 9,
            checkoutProvider: "fake",
            status: "invalid",
        });
        const alerts = await collectBillingSloAlerts();
        expect(alerts.map((alert) => alert.code)).toContain("catalog_invalid");
    });

    it("counts signature failures toward a spike", () => {
        const now = new Date("2026-08-01T00:00:00.000Z");
        let count = 0;
        for (let i = 0; i < 10; i += 1) {
            count = recordWebhookSignatureFailure(now);
        }
        expect(count).toBe(10);
    });
});
