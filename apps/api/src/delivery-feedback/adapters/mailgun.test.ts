import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { mailgunAdapter } from "./mailgun";

const signingKey = "mailgun-webhook-signing-key";

function hmac(timestamp: string, token: string, key = signingKey): string {
    return crypto
        .createHmac("sha256", key)
        .update(timestamp + token)
        .digest("hex");
}

function nowSeconds(): string {
    return String(Math.floor(Date.now() / 1000));
}

function body(
    eventData: Record<string, unknown>,
    sig?: Partial<{
        timestamp: string;
        token: string;
        signature: string;
        key: string;
    }>,
) {
    const timestamp = sig?.timestamp ?? nowSeconds();
    const token = sig?.token ?? "tok-abc";
    const signature =
        sig?.signature ?? hmac(timestamp, token, sig?.key ?? signingKey);
    return Buffer.from(
        JSON.stringify({
            signature: { timestamp, token, signature },
            "event-data": eventData,
        }),
        "utf8",
    );
}

describe("mailgunAdapter", () => {
    it("verifies a fresh, correctly signed request and returns the token", () => {
        const result = mailgunAdapter.verify({
            rawBody: body({ event: "delivered" }),
            headers: {},
            credential: signingKey,
        });
        expect(result.valid).toBe(true);
        expect(result.providerRequestId).toBe("tok-abc");
    });

    it("rejects a bad signature", () => {
        expect(
            mailgunAdapter.verify({
                rawBody: body(
                    { event: "delivered" },
                    { signature: "deadbeef" },
                ),
                headers: {},
                credential: signingKey,
            }).valid,
        ).toBe(false);
    });

    it("rejects a timestamp outside the five-minute window even if signed", () => {
        const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
        expect(
            mailgunAdapter.verify({
                rawBody: body({ event: "delivered" }, { timestamp: stale }),
                headers: {},
                credential: signingKey,
            }).valid,
        ).toBe(false);
    });

    it("accepts the previous signing key during rotation grace", () => {
        expect(
            mailgunAdapter.verify({
                rawBody: body({ event: "delivered" }, { key: "old-key" }),
                headers: {},
                credential: "new-key",
                previousCredential: "old-key",
            }).valid,
        ).toBe(true);
    });

    it("rejects a malformed envelope", () => {
        expect(() =>
            mailgunAdapter.validateEnvelope(
                Buffer.from(JSON.stringify({ signature: {} })),
            ),
        ).toThrow("malformed_payload");
    });

    it("maps delivered, failures, suppression, and complaint", () => {
        const delivered = mailgunAdapter.normalize(
            body({
                event: "delivered",
                recipient: "ada@example.com",
                id: "id-1",
                timestamp: 1521472262.9,
                message: { headers: { "message-id": "<m-1@mg>" } },
            }),
        )[0];
        expect(delivered).toMatchObject({
            eventType: "delivered",
            recipientEmail: "ada@example.com",
            providerMessageId: "<m-1@mg>",
            // event ids are only unique within a day → date-scoped key
            providerEventKey: "2018-03-19:id-1",
        });

        const hard = mailgunAdapter.normalize(
            body({
                event: "failed",
                severity: "permanent",
                reason: "bounce",
                recipient: "bob@example.com",
                id: "id-2",
                timestamp: 1521472262.9,
                "delivery-status": { code: 550, message: "no such user" },
            }),
        )[0];
        expect(hard).toMatchObject({
            eventType: "hard_bounce",
            bounceClass: "permanent",
            smtpCode: 550,
            reason: "bounce",
        });

        const temp = mailgunAdapter.normalize(
            body({
                event: "failed",
                severity: "temporary",
                recipient: "cara@example.com",
                id: "id-3",
            }),
        )[0];
        expect(temp.eventType).toBe("delayed");

        const suppressed = mailgunAdapter.normalize(
            body({
                event: "failed",
                severity: "permanent",
                reason: "suppress-bounce",
                recipient: "dan@example.com",
                id: "id-4",
            }),
        )[0];
        expect(suppressed.eventType).toBe("suppressed");

        const complaint = mailgunAdapter.normalize(
            body({
                event: "complained",
                recipient: "eve@example.com",
                id: "id-5",
            }),
        )[0];
        expect(complaint.eventType).toBe("complaint");

        const other = mailgunAdapter.normalize(
            body({ event: "opened", recipient: "fin@example.com", id: "id-6" }),
        )[0];
        expect(other.eventType).toBe("unknown");
    });
});
