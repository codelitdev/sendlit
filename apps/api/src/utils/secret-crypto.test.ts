import { afterEach, describe, expect, it } from "vitest";
import {
    assertEspEncryptionKeyConfigured,
    decryptSecret,
    encryptSecret,
} from "./secret-crypto";

const ORIGINAL_KEY = process.env.ESP_CREDENTIALS_ENCRYPTION_KEY;

afterEach(() => {
    process.env.ESP_CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("secret-crypto", () => {
    it("round-trips plaintext through AES-256-GCM", () => {
        const ciphertext = encryptSecret("smtp-password-value");
        expect(ciphertext).not.toContain("smtp-password-value");
        expect(ciphertext.split(".")).toHaveLength(3);
        expect(decryptSecret(ciphertext)).toBe("smtp-password-value");
    });

    it("produces different ciphertext for the same plaintext (random IV)", () => {
        const a = encryptSecret("same");
        const b = encryptSecret("same");
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe("same");
        expect(decryptSecret(b)).toBe("same");
    });

    it("rejects a malformed payload", () => {
        expect(() => decryptSecret("not-three-parts")).toThrow(
            "Malformed encrypted secret payload",
        );
    });

    it("rejects a tampered ciphertext", () => {
        const [iv, tag, body] = encryptSecret("secret").split(".");
        const tampered = Buffer.from(body!, "base64");
        tampered[0] ^= 0xff;
        expect(() =>
            decryptSecret(`${iv}.${tag}.${tampered.toString("base64")}`),
        ).toThrow();
    });

    it("accepts a base64-encoded 32-byte key", () => {
        process.env.ESP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(
            32,
            7,
        ).toString("base64");
        const cipher = encryptSecret("via-base64-key");
        expect(decryptSecret(cipher)).toBe("via-base64-key");
    });

    it("fails fast when the key is missing", () => {
        delete process.env.ESP_CREDENTIALS_ENCRYPTION_KEY;
        expect(() => assertEspEncryptionKeyConfigured()).toThrow(
            /ESP_CREDENTIALS_ENCRYPTION_KEY/,
        );
    });

    it("fails when the key is too short", () => {
        process.env.ESP_CREDENTIALS_ENCRYPTION_KEY = "too-short";
        expect(() => assertEspEncryptionKeyConfigured()).toThrow(/32 bytes/);
    });
});
