import { describe, expect, it } from "vitest";
import { postmarkAdapter } from "./postmark";

function body(payload: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(payload), "utf8");
}

describe("postmarkAdapter", () => {
    it("verifies shared secret via custom header or basic auth", () => {
        const credential = "super-secret-token";
        expect(
            postmarkAdapter.verify({
                rawBody: Buffer.from(""),
                headers: { "x-sendlit-webhook-secret": credential },
                credential,
            }).valid,
        ).toBe(true);

        const basic = Buffer.from(`hook:${credential}`).toString("base64");
        expect(
            postmarkAdapter.verify({
                rawBody: Buffer.from(""),
                headers: { authorization: `Basic ${basic}` },
                credential,
            }).valid,
        ).toBe(true);

        expect(
            postmarkAdapter.verify({
                rawBody: Buffer.from(""),
                headers: { "x-sendlit-webhook-secret": "wrong" },
                credential,
            }).valid,
        ).toBe(false);

        // Previous credential still accepted during rotation grace.
        expect(
            postmarkAdapter.verify({
                rawBody: Buffer.from(""),
                headers: { "x-sendlit-webhook-secret": "old-secret" },
                credential: "new-secret",
                previousCredential: "old-secret",
            }).valid,
        ).toBe(true);
    });

    it("rejects a malformed envelope", () => {
        expect(() =>
            postmarkAdapter.validateEnvelope(body({ MessageID: "x" })),
        ).toThrow("malformed_payload");
    });

    it("normalizes delivery, hard bounce, soft bounce, and complaint", () => {
        const delivery = postmarkAdapter.normalize(
            body({
                RecordType: "Delivery",
                MessageID: "pm-1",
                Recipient: "ada@example.com",
                DeliveredAt: "2024-01-01T00:00:00Z",
            }),
        )[0];
        expect(delivery).toMatchObject({
            eventType: "delivered",
            providerMessageId: "pm-1",
            recipientEmail: "ada@example.com",
            providerEventKey: "Delivery:pm-1:ada@example.com",
        });

        const hard = postmarkAdapter.normalize(
            body({
                RecordType: "Bounce",
                Type: "HardBounce",
                ID: 99,
                MessageID: "pm-2",
                Email: "bob@example.com",
                Description: "mailbox gone",
                BouncedAt: "2024-01-02T00:00:00Z",
            }),
        )[0];
        expect(hard).toMatchObject({
            eventType: "hard_bounce",
            bounceClass: "permanent",
            providerEventKey: "Bounce:99",
            reason: "mailbox gone",
        });

        const soft = postmarkAdapter.normalize(
            body({
                RecordType: "Bounce",
                Type: "MailboxFull",
                ID: 100,
                MessageID: "pm-3",
                Email: "carol@example.com",
            }),
        )[0];
        expect(soft).toMatchObject({
            eventType: "soft_bounce",
            bounceClass: "transient",
        });

        const complaint = postmarkAdapter.normalize(
            body({
                RecordType: "SpamComplaint",
                ID: 101,
                MessageID: "pm-4",
                Email: "dan@example.com",
            }),
        )[0];
        expect(complaint.eventType).toBe("complaint");
    });
});
