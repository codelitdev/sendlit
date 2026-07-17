import crypto from "crypto";
import { getSiteUrl } from "./mail";

/**
 * Generates an RFC 5322 `Message-ID` value (no angle brackets — nodemailer
 * adds them) used as the send-time correlation anchor stored on
 * `outbound_messages.rfcMessageId` before transport. This is the practical
 * v1 correlation tier: SendLit sends over generic SMTP relay rather than
 * each provider's REST API, so provider-supported opaque metadata/custom
 * arguments (the PRD's top correlation tier) aren't available until a
 * per-provider API client exists — see
 * `docs/bounces-and-complaints.md#6-correlation`.
 */
export function generateRfcMessageId(): string {
    const random = crypto.randomBytes(16).toString("hex");
    let domain = "sendlit.local";
    try {
        domain = new URL(getSiteUrl()).hostname || domain;
    } catch {
        // getSiteUrl() is always a valid URL in practice; fall back safely.
    }
    return `${random}@${domain}`;
}
