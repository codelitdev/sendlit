import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Derives a 32-byte AES-256 key from `ESP_CREDENTIALS_ENCRYPTION_KEY`. Accepts
 * either a base64-encoded 32-byte value or a plain string of at least 32
 * bytes (utf8) — matching the flexibility already given to `OAUTH_SIGNING_KEY`.
 */
function getKey(): Buffer {
    const raw = process.env.ESP_CREDENTIALS_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            "ESP_CREDENTIALS_ENCRYPTION_KEY environment variable is not defined",
        );
    }

    const base64Decoded = Buffer.from(raw, "base64");
    if (base64Decoded.length === 32) {
        return base64Decoded;
    }

    const utf8 = Buffer.from(raw, "utf8");
    if (utf8.length >= 32) {
        return utf8.subarray(0, 32);
    }

    throw new Error(
        "ESP_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (base64) or contain " +
            "at least 32 bytes (utf8). Generate one with: openssl rand -base64 32",
    );
}

/** Throws if the key is missing/malformed — call at startup to fail fast. */
export function assertEspEncryptionKeyConfigured(): void {
    getKey();
}

/** Encrypts `plaintext`, returning `iv.authTag.ciphertext` (each base64). */
export function encryptSecret(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(".");
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
        throw new Error("Malformed encrypted secret payload");
    }
    const key = getKey();
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextB64, "base64")),
        decipher.final(),
    ]);
    return plaintext.toString("utf8");
}
