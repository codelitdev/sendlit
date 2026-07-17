import crypto from "crypto";

/**
 * Do-not-send fingerprint over a normalized recipient address — HMAC-SHA256,
 * never an unsalted digest, so a leaked `email_suppressions` table can't be
 * dictionary/rainbow-table attacked back to real addresses. Versioned so the
 * key can rotate with dual lookup/write while existing rows are rewritten
 * (see `docs/bounces-and-complaints.md#8-suppression-model`). Only version 1
 * is wired today; a future rotation adds `SUPPRESSION_HASH_KEY_V2` and a
 * migration that rewrites `hashKeyVersion`.
 */
const CURRENT_HASH_KEY_VERSION = 1;

function envVarForVersion(version: number): string {
    return version === 1
        ? "SUPPRESSION_HASH_KEY"
        : `SUPPRESSION_HASH_KEY_V${version}`;
}

function getHashKey(version: number): Buffer {
    const envVar = envVarForVersion(version);
    const raw = process.env[envVar];
    if (!raw) {
        throw new Error(`${envVar} environment variable is not defined`);
    }
    return Buffer.from(raw, "utf8");
}

/** Throws if the current key is missing/malformed — call at startup to fail
 * fast, matching `assertEspEncryptionKeyConfigured`. */
export function assertSuppressionHashKeyConfigured(): void {
    getHashKey(CURRENT_HASH_KEY_VERSION);
}

export function currentHashKeyVersion(): number {
    return CURRENT_HASH_KEY_VERSION;
}

/** `normalizedRecipient` must already be normalized (see `utils/email.ts`) —
 * this function never normalizes on its own so callers can't accidentally
 * hash a raw, differently-cased address. */
export function hashRecipient(
    normalizedRecipient: string,
    version: number = CURRENT_HASH_KEY_VERSION,
): string {
    return crypto
        .createHmac("sha256", getHashKey(version))
        .update(normalizedRecipient)
        .digest("hex");
}
