import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
    API_KEY_PREFIX,
    displayPrefix,
    generateApiKeySecret,
    hashApiKeySecret,
} from "./secret";

describe("api key secret helpers", () => {
    it("generates a prefixed high-entropy secret", () => {
        const secret = generateApiKeySecret();
        expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
        expect(secret.length).toBeGreaterThan(API_KEY_PREFIX.length + 20);
        expect(generateApiKeySecret()).not.toBe(secret);
    });

    it("hashes with SHA-256 hex", () => {
        const secret = "sl_live_test";
        expect(hashApiKeySecret(secret)).toBe(
            createHash("sha256").update(secret).digest("hex"),
        );
        expect(hashApiKeySecret(secret)).toHaveLength(64);
    });

    it("exposes a short display prefix for UI/list surfaces", () => {
        const secret = generateApiKeySecret();
        expect(displayPrefix(secret)).toBe(secret.slice(0, 12));
        expect(displayPrefix(secret).length).toBe(12);
    });
});
