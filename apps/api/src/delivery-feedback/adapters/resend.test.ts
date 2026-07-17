import { describe, expect, it } from "vitest";
import { resendAdapter } from "./resend";

function body(payload: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(payload), "utf8");
}

describe("resendAdapter", () => {
    it("rejects a malformed envelope", () => {
        expect(() =>
            resendAdapter.validateEnvelope(body({ data: {} })),
        ).toThrow("malformed_payload");
    });

    it("maps Resend event types to canonical delivery events", () => {
        const delivered = resendAdapter.normalize(
            body({
                type: "email.delivered",
                data: {
                    email_id: "re_1",
                    to: ["ada@example.com"],
                    created_at: "2024-01-01T00:00:00Z",
                },
            }),
        )[0];
        expect(delivered).toMatchObject({
            eventType: "delivered",
            providerMessageId: "re_1",
            recipientEmail: "ada@example.com",
            providerEventKey: "re_1:email.delivered",
        });

        // Resend treats bounce as permanent.
        const bounced = resendAdapter.normalize(
            body({
                type: "email.bounced",
                data: {
                    email_id: "re_2",
                    to: "bob@example.com",
                    bounce: { message: "550 user unknown" },
                },
            }),
        )[0];
        expect(bounced).toMatchObject({
            eventType: "hard_bounce",
            bounceClass: "permanent",
            reason: "550 user unknown",
            recipientEmail: "bob@example.com",
        });

        const complained = resendAdapter.normalize(
            body({
                type: "email.complained",
                data: { email_id: "re_3", to: ["c@example.com"] },
            }),
        )[0];
        expect(complained.eventType).toBe("complaint");

        const unknown = resendAdapter.normalize(
            body({
                type: "email.opened",
                data: { email_id: "re_4", to: ["d@example.com"] },
            }),
        )[0];
        expect(unknown.eventType).toBe("unknown");
    });

    it("fails verification when Svix headers are missing or invalid", () => {
        const result = resendAdapter.verify({
            rawBody: body({ type: "email.delivered", data: {} }),
            headers: {},
            credential: "whsec_test",
        });
        expect(result.valid).toBe(false);
    });
});
