import type { EspProvider } from "./queries";

/** Which tracking SendLit adds to a message itself. */
export type SendLitTracking = { opens: boolean; clicks: boolean };

export type ProviderCapabilities = {
  send: boolean;
  testConnection: boolean;
  returnsProviderMessageId: boolean;
  feedbackAdapter: boolean;
  supportsIdempotencyKey: boolean;
  lookupSubmission: boolean;
  feedbackRequiredForOrganizationDelivery: boolean;
  /** SMTP headers that turn the provider's own open/click tracking off for
   * one message. SendLit tracks campaign mail itself; a provider tracking it
   * too wraps every link a second time, behind its own domain. Null when the
   * provider has no per-message switch (Resend and SES configure tracking
   * on the domain or configuration set; plain SMTP doesn't track). */
  ownTrackingOffHeaders: ((tracking: SendLitTracking) => Record<string, string>) | null;
};

/**
 * SMTP-style providers acknowledge submission synchronously but cannot report
 * asynchronous bounces or complaints back to SendLit. They are still valid
 * shared transports: activation requires a successful real SMTP test and the
 * organization UI makes the missing feedback capability explicit.
 */
const testVerifiedOnly: ProviderCapabilities = {
  send: true,
  testConnection: true,
  returnsProviderMessageId: false,
  feedbackAdapter: false,
  supportsIdempotencyKey: false,
  lookupSubmission: false,
  feedbackRequiredForOrganizationDelivery: false,
  ownTrackingOffHeaders: null,
};

export const providerCapabilities: Record<EspProvider, ProviderCapabilities> = {
  resend: {
    send: true,
    testConnection: true,
    returnsProviderMessageId: true,
    feedbackAdapter: true,
    supportsIdempotencyKey: true,
    lookupSubmission: false,
    feedbackRequiredForOrganizationDelivery: true,
    ownTrackingOffHeaders: null,
  },
  postmark: {
    send: true,
    testConnection: true,
    returnsProviderMessageId: true,
    feedbackAdapter: true,
    supportsIdempotencyKey: true,
    lookupSubmission: false,
    feedbackRequiredForOrganizationDelivery: true,
    // Postmark SMTP headers (tracking is per message or per stream).
    ownTrackingOffHeaders: ({ opens, clicks }) => ({
      ...(opens && { "X-PM-TrackOpens": "false" }),
      ...(clicks && { "X-PM-TrackLinks": "None" }),
    }),
  },
  // Feedback adapters exist for these, but organization delivery doesn't
  // yet require a verified connection before activation.
  ses: {
    ...testVerifiedOnly,
    returnsProviderMessageId: true,
    feedbackAdapter: true,
  },
  sendgrid: {
    ...testVerifiedOnly,
    returnsProviderMessageId: true,
    feedbackAdapter: true,
    // SendGrid SMTP API filters; click tracking is on by default.
    ownTrackingOffHeaders: ({ opens, clicks }) => ({
      "X-SMTPAPI": JSON.stringify({
        filters: {
          ...(clicks && {
            clicktrack: { settings: { enable: 0, enable_text: false } },
          }),
          ...(opens && { opentrack: { settings: { enable: 0 } } }),
        },
      }),
    }),
  },
  mailgun: {
    ...testVerifiedOnly,
    returnsProviderMessageId: true,
    feedbackAdapter: true,
    // Mailgun SMTP headers (override the domain's tracking setting).
    ownTrackingOffHeaders: ({ opens, clicks }) => ({
      ...(clicks && { "X-Mailgun-Track-Clicks": "no" }),
      ...(opens && { "X-Mailgun-Track-Opens": "no" }),
    }),
  },
  smtp: testVerifiedOnly,
};

export function canActivateForOrganization(provider: EspProvider): boolean {
  return providerCapabilities[provider].send;
}

export function requiresFeedbackForOrganization(provider: EspProvider): boolean {
  return providerCapabilities[provider].feedbackRequiredForOrganizationDelivery;
}

/** `headers` plus the provider's switches that stop it tracking what SendLit
 * already tracks. Headers the caller set win. */
export function withoutProviderTracking(
  provider: string | null | undefined,
  headers: Record<string, string> | undefined,
  tracking: SendLitTracking,
): Record<string, string> | undefined {
  const off =
    provider && (tracking.opens || tracking.clicks)
      ? providerCapabilities[provider as EspProvider]?.ownTrackingOffHeaders?.(tracking)
      : undefined;
  return off ? { ...off, ...headers } : headers;
}
