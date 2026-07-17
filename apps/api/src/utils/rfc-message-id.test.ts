import { describe, expect, it } from "vitest";
import { generateRfcMessageId } from "./rfc-message-id";

describe("generateRfcMessageId", () => {
    it("returns a local-part@domain without angle brackets", () => {
        const id = generateRfcMessageId();
        expect(id).toMatch(/^[0-9a-f]{32}@.+$/);
        expect(id).not.toContain("<");
        expect(id).not.toContain(">");
        // Domain comes from getSiteUrl() / DOMAIN env (setup.ts: sendlit.test)
        expect(id.split("@")[1]).toBe("sendlit.test");
    });

    it("generates unique values", () => {
        const a = generateRfcMessageId();
        const b = generateRfcMessageId();
        expect(a).not.toBe(b);
    });
});
