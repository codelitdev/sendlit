export function getEmailFrom({ name, email }: { name: string; email: string }) {
    return `${name} <${email}>`;
}

export function getSiteUrl(): string {
    return `${process.env.PROTOCOL || "https"}://${process.env.DOMAIN || "localhost"}`;
}

export function getUnsubLink(unsubscribeToken: string): string {
    return `${getSiteUrl()}/unsubscribe/${unsubscribeToken}`;
}

export function getTrackingPixelUrl(token: string): string {
    return `${getSiteUrl()}/track/open?d=${token}`;
}

export function getTrackedClickUrl(token: string): string {
    return `${getSiteUrl()}/track/click?d=${token}`;
}

/** Whether `url` already points at this API's tracking routes, including the
 * `/api/track/*` form embedded in mail sent before tracking links were fixed
 * to match where `tracking/routes.ts` is mounted. */
export function isTrackingUrl(url: string): boolean {
    const siteUrl = getSiteUrl();
    return (
        url.startsWith(`${siteUrl}/track/`) ||
        url.startsWith(`${siteUrl}/api/track/`)
    );
}
