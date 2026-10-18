import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emailMocks = vi.hoisted(() => ({
    createTransport: vi.fn(),
    sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
    createTransport: emailMocks.createTransport,
}));
vi.mock("../services/log", () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../observability/posthog", () => ({
    captureError: vi.fn(),
    captureEvent: vi.fn(),
}));
vi.mock("./metrics", () => ({ recordBillingMetric: vi.fn() }));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { billingCatalogRevisions, billingWebhookEvents } from "../db/schema";
import { truncateAll, type TestDb } from "../test/db";
import { pageBillingAlert } from "./alerts";
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
    emailMocks.createTransport.mockReturnValue({
        sendMail: emailMocks.sendMail,
    });
    await truncateAll(tdb);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

    it("sends billing emails only to BILLING_ALERT_EMAIL recipients", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("EMAIL_HOST", "mail.example.com");
        vi.stubEnv("EMAIL_FROM", "alerts@example.com");
        vi.stubEnv(
            "BILLING_ALERT_EMAIL",
            " admin@example.com, ops@example.com ",
        );

        await pageBillingAlert({
            code: "webhook_quarantined",
            message: "Review quarantined event",
            details: { count: 1 },
        });

        expect(emailMocks.createTransport).toHaveBeenCalledOnce();
        expect(emailMocks.sendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: "admin@example.com, ops@example.com",
            }),
        );
    });

    it("does not fall back to SUPER_ADMIN_EMAIL when alert recipients are unset", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("EMAIL_HOST", "mail.example.com");
        vi.stubEnv("EMAIL_FROM", "alerts@example.com");
        vi.stubEnv("BILLING_ALERT_EMAIL", "");
        vi.stubEnv("SUPER_ADMIN_EMAIL", "legacy@example.com");

        await pageBillingAlert({
            code: "webhook_quarantined",
            message: "Review quarantined event",
            details: { count: 1 },
        });

        expect(emailMocks.createTransport).not.toHaveBeenCalled();
        expect(emailMocks.sendMail).not.toHaveBeenCalled();
    });
});
