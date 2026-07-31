import type { EspProvider } from "./queries";

export type ProviderCapabilities = {
    send: boolean;
    testConnection: boolean;
    returnsProviderMessageId: boolean;
    feedbackAdapter: boolean;
    supportsIdempotencyKey: boolean;
    lookupSubmission: boolean;
    feedbackRequiredForOrganizationDelivery: boolean;
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
    },
    postmark: {
        send: true,
        testConnection: true,
        returnsProviderMessageId: true,
        feedbackAdapter: true,
        supportsIdempotencyKey: true,
        lookupSubmission: false,
        feedbackRequiredForOrganizationDelivery: true,
    },
    ses: { ...testVerifiedOnly, returnsProviderMessageId: true },
    sendgrid: { ...testVerifiedOnly, returnsProviderMessageId: true },
    mailgun: { ...testVerifiedOnly, returnsProviderMessageId: true },
    smtp: testVerifiedOnly,
};

export function canActivateForOrganization(provider: EspProvider): boolean {
    return providerCapabilities[provider].send;
}

export function requiresFeedbackForOrganization(
    provider: EspProvider,
): boolean {
    return providerCapabilities[provider]
        .feedbackRequiredForOrganizationDelivery;
}
