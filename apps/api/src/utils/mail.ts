export function getEmailFrom({ name, email }: { name: string; email: string }) {
    return `${name} <${email}>`;
}

export function getSiteUrl(): string {
    return `${process.env.PROTOCOL || "https"}://${process.env.DOMAIN || "localhost"}`;
}

export function getUnsubLink(unsubscribeToken: string): string {
    return `${getSiteUrl()}/unsubscribe/${unsubscribeToken}`;
}

/**
 * RFC 2369 / RFC 8058 headers for marketing (broadcast and sequence) mail.
 * Mailbox providers POST `List-Unsubscribe=One-Click` to the https URL, which
 * `tracking/routes.ts` handles without a confirmation page. The URL is the
 * contact's existing per-contact unsubscribe link. No mailto is included
 * because there is no configured unsubscribe mailbox to receive it.
 */
export function getListUnsubscribeHeaders(
    unsubscribeToken: string,
): Record<string, string> {
    return {
        "List-Unsubscribe": `<${getUnsubLink(unsubscribeToken)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
}

export function getTrackingPixelUrl(token: string): string {
    return `${getSiteUrl()}/track/open?d=${token}`;
}

export function getTrackedClickUrl(token: string): string {
    return `${getSiteUrl()}/track/click?d=${token}`;
}

/** Whether `url` already points at this API's tracking routes. */
export function isTrackingUrl(url: string): boolean {
    return url.startsWith(`${getSiteUrl()}/track/`);
}
