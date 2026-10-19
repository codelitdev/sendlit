import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const engine = {
  ingestWebhook: vi.fn(),
  runWebhookInboxBatch: vi.fn(),
};
const alerts = {
  recordWebhookSignatureFailure: vi.fn(() => 1),
  pageBillingAlert: vi.fn(async () => undefined),
};

mock.module("../engine", () => ({
  getBillingEngine: () => engine,
  billingWorkerId: (role = "billing") => `test-${role}`,
}));
mock.module("../alerts", () => alerts);

const { requestApp } = await import("../../test/http");
const { default: webhookRoutes } = await import("./routes");

function app() {
  const server = express();
  server.use(webhookRoutes);
  // Anything after the webhook router must not see the raw body route.
  server.use(express.json());
  return server;
}

function cloudEnv() {
  Object.assign(process.env, {
    SENDLIT_DEPLOYMENT_MODE: "cloud",
    BILLING_CHECKOUT_PROVIDER: "dodo",
    BILLING_ENABLED_PROVIDERS: "dodo",
    BILLING_CATALOG_REVISION: "1",
    BILLING_CURRENCY: "USD",
    BILLING_PRO_MONTH_AMOUNT_MINOR: "4900",
    BILLING_PRO_YEAR_AMOUNT_MINOR: "49000",
    BILLING_BUSINESS_MONTH_AMOUNT_MINOR: "19900",
    BILLING_BUSINESS_YEAR_AMOUNT_MINOR: "199000",
    DODO_PRO_MONTH_PRODUCT_ID: "pdt_pro_month",
    DODO_PRO_YEAR_PRODUCT_ID: "pdt_pro_year",
    DODO_BUSINESS_MONTH_PRODUCT_ID: "pdt_business_month",
    DODO_BUSINESS_YEAR_PRODUCT_ID: "pdt_business_year",
  });
}

const signed = {
  "content-type": "application/json",
  "webhook-id": "evt_1",
  "webhook-timestamp": "1700000000",
  "webhook-signature": "v1,abc",
};

function deliver(body: string | undefined, headers: Record<string, string> = signed) {
  return requestApp(app(), "/webhooks/billing/dodo", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  cloudEnv();
  engine.ingestWebhook.mockReset();
  engine.runWebhookInboxBatch.mockReset();
  engine.runWebhookInboxBatch.mockResolvedValue(0);
  alerts.recordWebhookSignatureFailure.mockClear();
  alerts.pageBillingAlert.mockClear();
});

describe("billing webhook ingress through handleBillingWebhook", () => {
  it("passes the raw body byte for byte and accepts it", async () => {
    engine.ingestWebhook.mockResolvedValue({ duplicate: false });
    const body =
      '{ "type":"subscription.active",  "data":{"subscription_id":"sub_1"} }';
    const response = await deliver(body);
    expect(response.status).toBe(202);
    expect(response.json<unknown>()).toEqual({ accepted: true });
    const [input] = engine.ingestWebhook.mock.calls[0]!;
    expect(input.provider).toBe("dodo");
    expect(input.raw.body).toBe(body);
    expect(input.raw.headers["webhook-id"]).toBe("evt_1");
    expect(engine.runWebhookInboxBatch).toHaveBeenCalledWith({
      workerId: "test-billing-webhook",
    });
    expect(alerts.recordWebhookSignatureFailure).not.toHaveBeenCalled();
  });

  it("answers 200 for a duplicate delivery", async () => {
    engine.ingestWebhook.mockResolvedValue({ duplicate: true });
    const response = await deliver("{}");
    expect(response.status).toBe(200);
    expect(response.json<unknown>()).toEqual({ accepted: true, duplicate: true });
  });

  it("counts a rejected signature (400) toward the spike alert", async () => {
    engine.ingestWebhook.mockRejectedValue(new Error("webhook_signature_invalid"));
    alerts.recordWebhookSignatureFailure.mockReturnValue(10);
    const response = await deliver("{}");
    expect(response.status).toBe(400);
    expect(response.json<unknown>()).toEqual({ accepted: false });
    expect(alerts.recordWebhookSignatureFailure).toHaveBeenCalledTimes(1);
    expect(alerts.pageBillingAlert).toHaveBeenCalledWith(
      expect.objectContaining({ code: "webhook_signature_spike" }),
    );
  });

  it("answers 400 without a raw JSON body, without calling the engine", async () => {
    const response = await deliver("payload=1", {
      ...signed,
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(response.status).toBe(400);
    expect(engine.ingestWebhook).not.toHaveBeenCalled();
    expect(alerts.recordWebhookSignatureFailure).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when a verified event cannot be stored, so the provider retries", async () => {
    engine.ingestWebhook.mockRejectedValue(new Error("connection terminated"));
    const response = await deliver("{}");
    expect(response.status).toBe(503);
    expect(response.json<unknown>()).toEqual({ accepted: false });
    // Not a signature problem: no alert count.
    expect(alerts.recordWebhookSignatureFailure).not.toHaveBeenCalled();
  });

  it("answers 503 billing_not_configured in OSS mode", async () => {
    process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
    delete process.env.BILLING_CHECKOUT_PROVIDER;
    delete process.env.BILLING_ENABLED_PROVIDERS;
    const response = await deliver("{}");
    expect(response.status).toBe(503);
    expect(response.json<unknown>()).toEqual({
      accepted: false,
      error: "billing_not_configured",
    });
    expect(engine.ingestWebhook).not.toHaveBeenCalled();
  });

  it("answers 404 for a provider that is not enabled", async () => {
    const response = await requestApp(app(), "/webhooks/billing/stripe", {
      method: "POST",
      headers: signed,
      body: "{}",
    });
    expect(response.status).toBe(404);
    expect(engine.ingestWebhook).not.toHaveBeenCalled();
  });

  it("rate limits the endpoint", async () => {
    engine.ingestWebhook.mockResolvedValue({ duplicate: true });
    let limited = 0;
    for (let index = 0; index < 305; index += 1) {
      const response = await deliver("{}");
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect(engine.ingestWebhook.mock.calls.length).toBeLessThanOrEqual(300);
  });
});
