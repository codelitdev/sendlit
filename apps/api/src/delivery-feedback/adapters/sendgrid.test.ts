import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { sendgridAdapter } from "./sendgrid";

// A throwaway P-256 keypair standing in for SendGrid's signing key; the public
// half is exported as base64 DER SPKI, exactly the shape SendGrid shows in the
// Event Webhook settings.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
});
const verificationKey = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

const { publicKey: otherPublicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
});
const otherVerificationKey = otherPublicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

function sign(rawBody: Buffer, timestamp: string): string {
    const signer = crypto.createSign("sha256");
    signer.update(Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]));
    signer.end();
    return signer.sign(privateKey).toString("base64");
}

function body(events: Record<string, unknown>[]) {
    return Buffer.from(JSON.stringify(events), "utf8");
}

function headers(rawBody: Buffer, timestamp = "1700000000") {
    return {
        "x-twilio-email-event-webhook-signature": sign(rawBody, timestamp),
        "x-twilio-email-event-webhook-timestamp": timestamp,
    };
}

describe("sendgridAdapter", () => {
    it("verifies a correctly signed payload", () => {
        const raw = body([{ event: "delivered", sg_event_id: "e1" }]);
        expect(
            sendgridAdapter.verify({
                rawBody: raw,
                headers: headers(raw),
                credential: verificationKey,
            }).valid,
        ).toBe(true);
    });

    it("rejects a tampered body, wrong key, or missing headers", () => {
        const raw = body([{ event: "delivered", sg_event_id: "e1" }]);
        const signed = headers(raw);

        // Body changed after signing.
        expect(
            sendgridAdapter.verify({
                rawBody: body([{ event: "bounce", sg_event_id: "e1" }]),
                headers: signed,
                credential: verificationKey,
            }).valid,
        ).toBe(false);

        // Signature made by a different key.
        expect(
            sendgridAdapter.verify({
                rawBody: raw,
                headers: signed,
                credential: otherVerificationKey,
            }).valid,
        ).toBe(false);

        // No signature headers at all.
        expect(
            sendgridAdapter.verify({
                rawBody: raw,
                headers: {},
                credential: verificationKey,
            }).valid,
        ).toBe(false);
    });

    it("accepts the previous key during rotation grace", () => {
        const raw = body([{ event: "delivered", sg_event_id: "e1" }]);
        expect(
            sendgridAdapter.verify({
                rawBody: raw,
                headers: headers(raw),
                credential: otherVerificationKey,
                previousCredential: verificationKey,
            }).valid,
        ).toBe(true);
    });

    it("rejects a non-array envelope", () => {
        expect(() =>
            sendgridAdapter.validateEnvelope(
                Buffer.from(JSON.stringify({ event: "delivered" })),
            ),
        ).toThrow("malformed_payload");
    });

    it("normalizes the batch into canonical events", () => {
        const events = sendgridAdapter.normalize(
            body([
                {
                    event: "delivered",
                    email: "ada@example.com",
                    sg_event_id: "ev-1",
                    sg_message_id: "msg-1",
                    timestamp: 1700000000,
                },
                {
                    event: "bounce",
                    type: "bounce",
                    email: "bob@example.com",
                    sg_event_id: "ev-2",
                    sg_message_id: "msg-2",
                    reason: "550 5.1.1 user unknown",
                    status: "5.1.1",
                },
                {
                    event: "bounce",
                    type: "blocked",
                    email: "cara@example.com",
                    sg_event_id: "ev-3",
                },
                {
                    event: "deferred",
                    email: "dan@example.com",
                    sg_event_id: "ev-4",
                },
                {
                    event: "dropped",
                    email: "eve@example.com",
                    sg_event_id: "ev-5",
                    reason: "Bounced Address",
                },
                {
                    event: "spamreport",
                    email: "fin@example.com",
                    sg_event_id: "ev-6",
                },
                {
                    event: "open",
                    email: "gus@example.com",
                    sg_event_id: "ev-7",
                },
            ]),
        );

        expect(events.map((e) => e.eventType)).toEqual([
            "delivered",
            "hard_bounce",
            "soft_bounce",
            "delayed",
            "rejected",
            "complaint",
            "unknown",
        ]);
        expect(events[0]).toMatchObject({
            providerEventKey: "ev-1",
            providerMessageId: "msg-1",
            recipientEmail: "ada@example.com",
        });
        expect(events[1]).toMatchObject({
            bounceClass: "permanent",
            enhancedStatusCode: "5.1.1",
            reason: "550 5.1.1 user unknown",
        });
        expect(events[2].bounceClass).toBe("transient");
    });
});
