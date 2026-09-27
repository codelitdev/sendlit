import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function parseKey(raw: string | undefined, missingCode: string): Buffer {
    if (!raw) throw new Error(missingCode);
    if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            raw,
        )
    ) {
        throw new Error("BILLING_DATA_ENCRYPTION_KEY_must_be_base64");
    }
    const base64 = Buffer.from(raw, "base64");
    if (base64.length === 32) return base64;
    throw new Error("BILLING_DATA_ENCRYPTION_KEY_must_be_32_bytes");
}

function key(): Buffer {
    return parseKey(
        process.env.BILLING_DATA_ENCRYPTION_KEY,
        "BILLING_DATA_ENCRYPTION_KEY_missing",
    );
}

export function assertBillingEncryptionKeyConfigured(): void {
    key();
}

export function encryptBillingValue(value: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, key(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
        .map((part) => part.toString("base64"))
        .join(".");
}

export function decryptBillingValue(payload: string): string {
    const [iv, tag, ciphertext] = payload.split(".");
    if (!iv || !tag || !ciphertext)
        throw new Error("billing_ciphertext_invalid");
    const ivBytes = Buffer.from(iv, "base64");
    const tagBytes = Buffer.from(tag, "base64");
    const ciphertextBytes = Buffer.from(ciphertext, "base64");
    const keys = [key()];
    if (process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS) {
        keys.push(
            parseKey(
                process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS,
                "BILLING_DATA_ENCRYPTION_KEY_PREVIOUS_invalid",
            ),
        );
    }
    let lastError: unknown;
    for (const candidate of keys) {
        try {
            const decipher = crypto.createDecipheriv(
                algorithm,
                candidate,
                ivBytes,
            );
            decipher.setAuthTag(tagBytes);
            return Buffer.concat([
                decipher.update(ciphertextBytes),
                decipher.final(),
            ]).toString("utf8");
        } catch (error) {
            lastError = error;
        }
    }
    const failure = new Error("billing_ciphertext_authentication_failed");
    (failure as Error & { cause?: unknown }).cause = lastError;
    throw failure;
}
