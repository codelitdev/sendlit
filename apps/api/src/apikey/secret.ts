import { createHash, randomBytes } from "crypto";

/** Stripe-style prefix: identifies leaked SendLit keys in secret scanners and
 * makes the credential type obvious at a glance without exposing the secret. */
export const API_KEY_PREFIX = "sl_live_";

/** Characters of the secret shown in list/UI surfaces (`sl_live_a1b2`). */
const DISPLAY_PREFIX_LENGTH = 12;

/** 32 CSPRNG bytes = 256 bits of entropy, base64url so the key stays
 * copy-paste/URL safe. */
export function generateApiKeySecret(): string {
    return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Keys are stored hashed, like passwords — but as a plain SHA-256, not
 * bcrypt/argon2: the secret is already 256 bits of CSPRNG output, so
 * brute-forcing the hash is infeasible and a slow KDF would only tax every
 * authenticated request. */
export function hashApiKeySecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}

export function displayPrefix(secret: string): string {
    return secret.slice(0, DISPLAY_PREFIX_LENGTH);
}
