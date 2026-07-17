import { createHmac } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
    assertSuppressionHashKeyConfigured,
    currentHashKeyVersion,
    hashRecipient,
} from "./suppression-hash";

const ORIGINAL = process.env.SUPPRESSION_HASH_KEY;

afterEach(() => {
    process.env.SUPPRESSION_HASH_KEY = ORIGINAL;
});

describe("suppression hash", () => {
    it("HMAC-SHA256s the normalized recipient with the current key version", () => {
        const recipient = "ada@example.com";
        const expected = createHmac("sha256", Buffer.from(ORIGINAL!, "utf8"))
            .update(recipient)
            .digest("hex");
        expect(hashRecipient(recipient)).toBe(expected);
        expect(currentHashKeyVersion()).toBe(1);
    });

    it("is deterministic for the same input", () => {
        expect(hashRecipient("same@example.com")).toBe(
            hashRecipient("same@example.com"),
        );
    });

    it("does not normalize — callers must pass a normalized address", () => {
        // Different casing produces different digests by design.
        expect(hashRecipient("Ada@Example.com")).not.toBe(
            hashRecipient("ada@example.com"),
        );
    });

    it("fails fast when the key is missing", () => {
        delete process.env.SUPPRESSION_HASH_KEY;
        expect(() => assertSuppressionHashKeyConfigured()).toThrow(
            /SUPPRESSION_HASH_KEY/,
        );
    });
});
