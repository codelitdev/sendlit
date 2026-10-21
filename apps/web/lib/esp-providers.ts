import type { EspProvider } from "@/lib/api";

/** ESP providers in the order the provider picker lists them. */
export const ESP_PROVIDERS: Array<{ value: EspProvider; label: string }> = [
  { value: "smtp", label: "Custom SMTP" },
  { value: "sendgrid", label: "SendGrid" },
  { value: "mailgun", label: "Mailgun" },
  { value: "postmark", label: "Postmark" },
  { value: "ses", label: "Amazon SES" },
  { value: "resend", label: "Resend" },
];

/** Display name of a provider, e.g. "Amazon SES" for `ses`. */
export function espProviderLabel(provider: string): string {
  return ESP_PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}
