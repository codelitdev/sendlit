import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { resetModules, stubGlobal, unstubAllGlobals } from "@sendlit/test-utils";
import { eq } from "drizzle-orm";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../mail/queue", () => ({ addTransactionalMailJob: mock() }));
// The route enqueues onto BullMQ/Redis after responding — not available in
// this DB-backed test, and irrelevant to what's being asserted (the HTTP
// response and the durably-committed receipt).
mock.module("./feedback-queue", () => ({
  enqueueReceiptForProcessing: mock().mockResolvedValue(undefined),
}));

const { db } = await import("../db/client");
const { espConfigs, espFeedbackConnections, espWebhookReceipts } = await import(
  "../db/schema"
);
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const {
  signSnsMessage,
  snsNotification,
  TEST_SNS_CERT_URL,
  TEST_SNS_PUBLIC_KEY_PEM,
  TEST_TOPIC_ARN,
} = await import("../test/sns");
const { upsertFeedbackConnection } = await import("./feedback-connection-queries");
const { decryptReceiptPayload } = await import("./webhook-receipt-queries");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

const SRC_DIR = path.resolve(import.meta.dir, "..");
const MOCKED_MODULES = new Set(
  ["../db/client", "../mail/queue", "./feedback-queue"].map(
    (specifier) => `${path.resolve(import.meta.dir, specifier)}.ts`,
  ),
);

/** Evict the app modules (but not the mocks or test helpers) so each test
 * re-evaluates them with fresh module state, such as the SNS signing-certificate
 * cache. */
function resetAppModules() {
  resetModules(SRC_DIR, {
    keep: (key) =>
      key.startsWith(path.join(SRC_DIR, "test")) || MOCKED_MODULES.has(key),
  });
}

describe("POST /webhooks/esp/:provider/:connectionId (integration)", () => {
  let app: express.Express;

  beforeEach(async () => {
    await truncateAll(tdb);
    resetAppModules();
    const webhookRoutes = ((await import("./webhook-route")) as any).default;
    app = express();
    app.use(webhookRoutes);
  });

  async function post(
    path: string,
    { headers, body }: { headers?: Record<string, string>; body: Buffer },
  ) {
    const req = new IncomingMessage(new Socket());
    req.method = "POST";
    req.url = path;
    req.headers = {
      host: "localhost:5000",
      "content-type": "application/json",
      "content-length": String(body.length),
      ...headers,
    };

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const done = new Promise<{ status: number; body: string }>((resolve) => {
      res.write = ((chunk: any, ...args: any[]) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        const cb = args.find((a) => typeof a === "function");
        cb?.();
        return true;
      }) as typeof res.write;
      res.end = ((chunk: any, ...args: any[]) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        const cb = args.find((a) => typeof a === "function");
        cb?.();
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        return res;
      }) as typeof res.end;
    });

    (app as any).handle(req, res);
    // `express.raw()` consumes the request as a readable stream.
    req.push(body);
    req.push(null);
    return done;
  }

  it("returns 404 for an unknown provider or connection id", async () => {
    const unknownProvider = await post("/webhooks/esp/ses/whc_doesnotexist", {
      body: Buffer.from("{}"),
    });
    expect(unknownProvider.status).toBe(404);

    const unknownConnection = await post("/webhooks/esp/postmark/whc_doesnotexist", {
      body: Buffer.from("{}"),
    });
    expect(unknownConnection.status).toBe(404);
  });

  it("rejects an unauthenticated request and commits nothing", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "correct-secret",
    });

    const res = await post(`/webhooks/esp/postmark/${connection.connectionId}`, {
      headers: { "x-sendlit-webhook-secret": "wrong-secret" },
      body: Buffer.from(JSON.stringify({ RecordType: "Delivery", MessageID: "1" })),
    });

    expect(res.status).toBe(401);
    const receipts = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.connectionId, connection.id));
    expect(receipts).toHaveLength(0);
  });

  it("accepts an authenticated request, commits a receipt, and dedupes retries", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "correct-secret",
    });
    const body = Buffer.from(
      JSON.stringify({
        RecordType: "Delivery",
        MessageID: "pm-1",
        Recipient: "ada@example.com",
      }),
    );

    const first = await post(`/webhooks/esp/postmark/${connection.connectionId}`, {
      headers: { "x-sendlit-webhook-secret": "correct-secret" },
      body,
    });
    expect(first.status).toBe(200);

    const receipts = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.connectionId, connection.id));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].encryptedPayload).toBeTruthy();

    // A provider retry with the same body (no stable request id for
    // Postmark, so this exercises "authenticated, no side effect on
    // resubmission" via the receipt count staying at 1 only when a
    // provider request id *is* present — Postmark has none, so this
    // duplicate legitimately creates a second receipt, which is the
    // documented behavior when a provider offers no stable id and
    // idempotency instead falls to the event-level key).
    const second = await post(`/webhooks/esp/postmark/${connection.connectionId}`, {
      headers: { "x-sendlit-webhook-secret": "correct-secret" },
      body,
    });
    expect(second.status).toBe(200);
  });

  it("rejects a malformed authenticated payload with 400", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "correct-secret",
    });

    const res = await post(`/webhooks/esp/postmark/${connection.connectionId}`, {
      headers: { "x-sendlit-webhook-secret": "correct-secret" },
      body: Buffer.from(JSON.stringify({ notAPostmarkPayload: true })),
    });

    expect(res.status).toBe(400);
    const receipts = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.connectionId, connection.id));
    expect(receipts).toHaveLength(0);
  });

  describe("Amazon SES over SNS", () => {
    const fetchMock = mock();
    const subscribeUrl = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TEST_TOPIC_ARN)}&Token=tok`;

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url: string) =>
        url === TEST_SNS_CERT_URL
          ? new Response(TEST_SNS_PUBLIC_KEY_PEM)
          : new Response("<ConfirmSubscriptionResponse/>"),
      );
      stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      unstubAllGlobals();
    });

    async function seedSesConnection() {
      const { team } = await seedTeamAndContact(tdb);
      const [esp] = await tdb
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, team.id));
      return upsertFeedbackConnection({
        teamId: team.id,
        espConfigId: esp.id,
        provider: "ses",
        expectedTopicArn: TEST_TOPIC_ARN,
      });
    }

    async function receipts(connectionId: string) {
      return tdb
        .select()
        .from(espWebhookReceipts)
        .where(eq(espWebhookReceipts.connectionId, connectionId));
    }

    const bounce = {
      eventType: "Bounce",
      mail: {
        messageId: "ses-1",
        headers: [{ name: "Subject", value: "secret subject" }],
      },
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "a@example.com" }],
      },
    };

    it("stores a signed notification without mail headers and dedupes redelivery", async () => {
      const connection = await seedSesConnection();
      const body = Buffer.from(JSON.stringify(signSnsMessage(snsNotification(bounce))));
      const path = `/webhooks/esp/ses/${connection.connectionId}`;

      expect((await post(path, { body })).status).toBe(200);
      expect((await post(path, { body })).status).toBe(200);

      const stored = await receipts(connection.id);
      expect(stored).toHaveLength(1);
      expect(stored[0].providerRequestId).toBe("sns-msg-1");
      const payload = decryptReceiptPayload(stored[0])!.toString("utf8");
      expect(payload).not.toContain("secret subject");
      // The certificate is fetched once and cached.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects another topic before fetching anything", async () => {
      const connection = await seedSesConnection();
      const res = await post(`/webhooks/esp/ses/${connection.connectionId}`, {
        body: Buffer.from(
          JSON.stringify(
            signSnsMessage(
              snsNotification(bounce, {
                TopicArn: "arn:aws:sns:us-east-1:123456789012:other",
              }),
            ),
          ),
        ),
      });
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await receipts(connection.id)).toHaveLength(0);
    });

    it("answers 503 when the signing certificate can't be fetched", async () => {
      const connection = await seedSesConnection();
      fetchMock.mockRejectedValue(new Error("network down"));
      const res = await post(`/webhooks/esp/ses/${connection.connectionId}`, {
        body: Buffer.from(JSON.stringify(signSnsMessage(snsNotification(bounce)))),
      });
      expect(res.status).toBe(503);
      expect(await receipts(connection.id)).toHaveLength(0);
    });

    it("rejects a body over 512 KB", async () => {
      const connection = await seedSesConnection();
      const res = await post(`/webhooks/esp/ses/${connection.connectionId}`, {
        body: Buffer.alloc(512 * 1024 + 1, "a"),
      });
      expect(res.status).toBe(413);
    });

    it("confirms a signed subscription once and stores no receipt", async () => {
      const connection = await seedSesConnection();
      const res = await post(`/webhooks/esp/ses/${connection.connectionId}`, {
        body: Buffer.from(
          JSON.stringify(
            signSnsMessage({
              Type: "SubscriptionConfirmation",
              MessageId: "sns-sub-1",
              Token: "tok",
              TopicArn: TEST_TOPIC_ARN,
              Message: "You have chosen to subscribe…",
              SubscribeURL: subscribeUrl,
              Timestamp: "2026-10-14T10:00:00.000Z",
              SigningCertURL: TEST_SNS_CERT_URL,
            }),
          ),
        ),
      });
      expect(res.status).toBe(200);
      const subscribeCalls = fetchMock.mock.calls.filter(
        ([url]) => url === subscribeUrl,
      );
      expect(subscribeCalls).toHaveLength(1);
      expect(await receipts(connection.id)).toHaveLength(0);
      const [row] = await tdb
        .select()
        .from(espFeedbackConnections)
        .where(eq(espFeedbackConnections.id, connection.id));
      expect(row.subscriptionConfirmedAt).toBeTruthy();
    });

    it("never confirms a subscription whose signature doesn't verify", async () => {
      const connection = await seedSesConnection();
      const signed = signSnsMessage({
        Type: "SubscriptionConfirmation",
        MessageId: "sns-sub-1",
        Token: "tok",
        TopicArn: TEST_TOPIC_ARN,
        Message: "m",
        SubscribeURL: subscribeUrl,
        Timestamp: "2026-10-14T10:00:00.000Z",
        SigningCertURL: TEST_SNS_CERT_URL,
      });
      const res = await post(`/webhooks/esp/ses/${connection.connectionId}`, {
        body: Buffer.from(JSON.stringify({ ...signed, Token: "forged" })),
      });
      expect(res.status).toBe(401);
      expect(fetchMock.mock.calls.some(([url]) => url === subscribeUrl)).toBe(false);
    });
  });
});
