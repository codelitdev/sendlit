/**
 * Normalizes an email address for suppression/correlation matching: trim,
 * Unicode NFC, lowercase over the full addr-spec. Deliberately does not
 * apply Gmail-style dot/plus-tag aliasing — SendLit is not the mailbox
 * provider and must not guess address equivalence beyond RFC normalization
 * (see docs/bounces-and-complaints.md#8-suppression-model).
 */
export function normalizeEmail(email: string): string {
    return email.trim().normalize("NFC").toLowerCase();
}
