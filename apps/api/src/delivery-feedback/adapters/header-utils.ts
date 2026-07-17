import crypto from "crypto";

export function headerString(
    headers: Record<string, string | string[] | undefined>,
    name: string,
): string {
    // Express lower-cases incoming header names; accept either case so unit
    // tests can pass either form.
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Timing-safe string comparison — always compares equal-length buffers
 * (padding the shorter one against itself) so a length mismatch doesn't
 * short-circuit and leak timing information. */
export function constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}
