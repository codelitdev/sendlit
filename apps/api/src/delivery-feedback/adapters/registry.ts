import { feedbackCapableProviders } from "../../config/constants";
import { mailgunAdapter } from "./mailgun";
import { postmarkAdapter } from "./postmark";
import { resendAdapter } from "./resend";
import { sendgridAdapter } from "./sendgrid";
import type { ProviderAdapter } from "./types";

/** Every provider presented as feedback-capable must have an entry here —
 * see `feedbackCapableProviders` and the Non-goals section of
 * `docs/bounces-and-complaints.md` ("A provider must have a reviewed
 * adapter before SendLit presents it as feedback-capable"). */
const adapters: Record<string, ProviderAdapter> = {
    resend: resendAdapter,
    postmark: postmarkAdapter,
    sendgrid: sendgridAdapter,
    mailgun: mailgunAdapter,
};

export function getProviderAdapter(provider: string): ProviderAdapter | null {
    return adapters[provider] ?? null;
}

// Fails fast if a capable provider is ever declared without a matching
// adapter registered, rather than discovering the gap at request time.
for (const provider of feedbackCapableProviders) {
    if (!adapters[provider]) {
        throw new Error(
            `feedbackCapableProviders declares "${provider}" but no adapter is registered for it`,
        );
    }
}
