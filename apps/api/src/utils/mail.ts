export function getEmailFrom({ name, email }: { name: string; email: string }) {
  return `${name} <${email}>`;
}

export function getSiteUrl(): string {
  return `${process.env.PROTOCOL || "https"}://${process.env.DOMAIN || "localhost"}`;
}

// Link builders take an optional `origin`: the team's verified tracking
// domain (`settings/tracking-domain`), else this API's own host.

export function getUnsubLink(unsubscribeToken: string, origin = getSiteUrl()): string {
  return `${origin}/unsubscribe/${unsubscribeToken}`;
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
  origin?: string,
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${getUnsubLink(unsubscribeToken, origin)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function getTrackingPixelUrl(token: string, origin = getSiteUrl()): string {
  return `${origin}/track/open?d=${token}`;
}

export function getTrackedClickUrl(token: string, origin = getSiteUrl()): string {
  return `${origin}/track/click?d=${token}`;
}

/** Whether `url` already points at this API's tracking routes, on its own
 * host or on `origin`. */
export function isTrackingUrl(url: string, origin?: string): boolean {
  return [getSiteUrl(), origin].some((o) => o && url.startsWith(`${o}/track/`));
}

/** Hosted web version of one email ("view in browser"). */
export function getViewInBrowserUrl(token: string, origin = getSiteUrl()): string {
  return `${origin}/view/${token}`;
}

export function isViewInBrowserUrl(url: string, origin?: string): boolean {
  return [getSiteUrl(), origin].some((o) => o && url.startsWith(`${o}/view/`));
}

/** Domains whose mail runs a sequence but is never sent: the RFC 2606/6761
 * reserved names, and `test.com` as Loops does (a real domain whose owner
 * shouldn't get our test mail). See docs/custom_events.md#test-addresses. */
const TEST_DOMAINS = new Set(["example.com", "example.net", "example.org", "test.com"]);
const TEST_TLDS = ["test", "example", "invalid", "localhost"];

export function isTestAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (TEST_DOMAINS.has(domain)) return true;
  const tld = domain.split(".").pop() ?? "";
  return TEST_TLDS.includes(tld);
}
