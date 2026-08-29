import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptBillingValue, encryptBillingValue } from "./crypto";

const originalKey = process.env.BILLING_DATA_ENCRYPTION_KEY;
const originalPreviousKey = process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS;
beforeEach(() => {
    process.env.BILLING_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
        "base64",
    );
});
afterEach(() => {
    if (originalKey === undefined)
        delete process.env.BILLING_DATA_ENCRYPTION_KEY;
    else process.env.BILLING_DATA_ENCRYPTION_KEY = originalKey;
    if (originalPreviousKey === undefined)
        delete process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS;
    else process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS = originalPreviousKey;
});

describe("billing ciphertext", () => {
    it("round trips with an exact 32-byte base64 key", () => {
        const value = encryptBillingValue("provider checkout URL");
        expect(decryptBillingValue(value)).toBe("provider checkout URL");
    });

    it("rejects ambiguous non-base64 or wrong-length keys", () => {
        process.env.BILLING_DATA_ENCRYPTION_KEY = "a".repeat(32);
        expect(() => encryptBillingValue("secret")).toThrow("must_be_32_bytes");
        process.env.BILLING_DATA_ENCRYPTION_KEY = "not base64!";
        expect(() => encryptBillingValue("secret")).toThrow("must_be_base64");
    });

    it("decrypts with the previous key during rotation", () => {
        const oldKey = Buffer.alloc(32, 8).toString("base64");
        process.env.BILLING_DATA_ENCRYPTION_KEY = oldKey;
        const value = encryptBillingValue("rotating secret");
        process.env.BILLING_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
            "base64",
        );
        process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS = oldKey;
        expect(decryptBillingValue(value)).toBe("rotating secret");
        delete process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS;
    });
});
