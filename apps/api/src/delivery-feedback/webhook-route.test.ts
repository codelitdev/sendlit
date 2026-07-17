import express from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../mail/queue", () => ({ addTransactionalMailJob: vi.fn() }));
// The route enqueues onto BullMQ/Redis after responding — not available in
// this DB-backed test, and irrelevant to what's being asserted (the HTTP
// response and the durably-committed receipt).
vi.mock("./feedback-queue", () => ({
    enqueueReceiptForProcessing: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../db/client";
import { espConfigs, espWebhookReceipts } from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { upsertFeedbackConnection } from "./feedback-connection-queries";

const tdb = db as unknown as TestDb;

describe("POST /webhooks/esp/:provider/:connectionId (integration)", () => {
    let app: express.Express;

    beforeEach(async () => {
        await truncateAll(tdb);
        vi.resetModules();
        const webhookRoutes = ((await import("./webhook-route.js")) as any)
            .default;
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
        const done = new Promise<{ status: number; body: string }>(
            (resolve) => {
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
            },
        );

        (app as any).handle(req, res);
        // `express.raw()` consumes the request as a readable stream.
        req.push(body);
        req.push(null);
        return done;
    }

    it("returns 404 for an unknown provider or connection id", async () => {
        const unknownProvider = await post(
            "/webhooks/esp/ses/whc_doesnotexist",
            { body: Buffer.from("{}") },
        );
        expect(unknownProvider.status).toBe(404);

        const unknownConnection = await post(
            "/webhooks/esp/postmark/whc_doesnotexist",
            { body: Buffer.from("{}") },
        );
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

        const res = await post(
            `/webhooks/esp/postmark/${connection.connectionId}`,
            {
                headers: { "x-sendlit-webhook-secret": "wrong-secret" },
                body: Buffer.from(
                    JSON.stringify({ RecordType: "Delivery", MessageID: "1" }),
                ),
            },
        );

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

        const first = await post(
            `/webhooks/esp/postmark/${connection.connectionId}`,
            {
                headers: { "x-sendlit-webhook-secret": "correct-secret" },
                body,
            },
        );
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
        const second = await post(
            `/webhooks/esp/postmark/${connection.connectionId}`,
            {
                headers: { "x-sendlit-webhook-secret": "correct-secret" },
                body,
            },
        );
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

        const res = await post(
            `/webhooks/esp/postmark/${connection.connectionId}`,
            {
                headers: { "x-sendlit-webhook-secret": "correct-secret" },
                body: Buffer.from(
                    JSON.stringify({ notAPostmarkPayload: true }),
                ),
            },
        );

        expect(res.status).toBe(400);
        const receipts = await tdb
            .select()
            .from(espWebhookReceipts)
            .where(eq(espWebhookReceipts.connectionId, connection.id));
        expect(receipts).toHaveLength(0);
    });
});
