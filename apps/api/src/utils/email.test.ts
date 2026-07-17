import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
    it("trims, lowercases, and NFC-normalizes", () => {
        expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
        // precomposed vs decomposed é (NFC)
        const decomposed = "cafe\u0301@example.com";
        const composed = "caf\u00e9@example.com";
        expect(normalizeEmail(decomposed)).toBe(normalizeEmail(composed));
    });

    it("does not apply Gmail-style alias collapsing", () => {
        expect(normalizeEmail("a.b+tag@gmail.com")).toBe("a.b+tag@gmail.com");
        expect(normalizeEmail("ab@gmail.com")).toBe("ab@gmail.com");
    });
});
