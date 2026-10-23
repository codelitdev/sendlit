/**
 * Shared vocabulary for importing contacts from another platform's CSV
 * export (beehiiv, Mailchimp, Substack, Kit/ConvertKit, ...): which SendLit
 * field a column header most likely holds, and what a source status means.
 * The web importer uses it to pre-fill the column mapping; the API uses it to
 * interpret each row's status, so both agree.
 */

export const contactImportFields = [
  "email",
  "name",
  "first_name",
  "last_name",
  "tags",
  "status",
  "created_at",
  /** Each value becomes a `<column>:<value>` tag, e.g. beehiiv's `tier`. */
  "tag_from_value",
  "custom_field",
  "ignore",
] as const;
export type ContactImportField = (typeof contactImportFields)[number];

/** Normalized header (lowercase, runs of non-alphanumerics as `_`). */
export function normalizeImportHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const HEADER_FIELDS: Record<string, ContactImportField> = {};
function headers(field: ContactImportField, names: string[]) {
  for (const name of names) HEADER_FIELDS[name] = field;
}
headers("email", [
  "email",
  "email_address",
  "e_mail",
  "emailaddress",
  "subscriber_email",
  "contact_email",
  "mail",
]);
headers("name", ["name", "full_name", "fullname", "display_name", "subscriber_name"]);
headers("first_name", ["first_name", "firstname", "fname", "given_name"]);
headers("last_name", ["last_name", "lastname", "lname", "surname", "family_name"]);
headers("tags", ["tags", "tag", "labels"]);
headers("status", [
  "status",
  "subscription_status",
  "subscriber_status",
  "member_status",
  "state",
]);
headers("created_at", [
  "created_at",
  "created",
  "created_date",
  "date_added",
  "subscribed_at",
  "subscribe_date",
  "subscription_date",
  "signup_date",
  "sign_up_date",
  "optin_time",
  "confirm_time",
  "joined_at",
]);
headers("tag_from_value", ["tier", "plan", "subscription_tier"]);
// Written by SendLit's own export; the suppression list carries it.
headers("ignore", ["suppression_reason"]);

/** The SendLit field a column header most likely holds; anything
 * unrecognised becomes a custom field keyed by its normalized header. */
export function guessContactImportField(header: string): ContactImportField {
  return HEADER_FIELDS[normalizeImportHeader(header)] ?? "custom_field";
}

/** Strictness order: an import can move a contact right, never left. */
export const contactImportStatuses = [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
] as const;
export type ContactImportStatus = (typeof contactImportStatuses)[number];

export type ContactImportStatusResult =
  | { status: ContactImportStatus; tag?: string }
  | { skip: "pending_confirmation" | "unknown_status" };

const STATUS_VALUES: Record<string, ContactImportStatusResult> = {};
function statuses(result: ContactImportStatusResult, values: string[]) {
  for (const value of values) STATUS_VALUES[value] = result;
}
statuses({ status: "subscribed" }, [
  "",
  "active",
  "subscribed",
  "subscriber",
  "confirmed",
  "opted_in",
  "true",
  "yes",
  "1",
]);
// beehiiv's "Paused" subscribers still want the newsletter, just not now.
statuses({ status: "subscribed", tag: "paused" }, ["paused"]);
statuses({ status: "unsubscribed" }, [
  "unsubscribed",
  "unsubscribe",
  "inactive",
  "cancelled",
  "canceled",
  "opted_out",
  "disabled",
  "deactivated",
  "false",
  "no",
  "0",
]);
statuses({ status: "bounced" }, [
  "bounced",
  "bounce",
  "hard_bounce",
  "hard_bounced",
  "cleaned",
  "invalid",
]);
statuses({ status: "complained" }, [
  "complained",
  "complaint",
  "spam",
  "spam_complaint",
  "marked_as_spam",
  "abuse",
]);
statuses({ skip: "pending_confirmation" }, [
  "pending",
  "needs_approval",
  "unconfirmed",
  "awaiting_confirmation",
  "not_confirmed",
]);

/** Interprets a source status (case and punctuation insensitive). Pending
 * and unknown statuses are skipped by default; callers decide. */
export function normalizeImportStatus(
  raw: string | undefined,
): ContactImportStatusResult {
  return STATUS_VALUES[normalizeImportHeader(raw ?? "")] ?? { skip: "unknown_status" };
}

/**
 * The status every row of an export file has when the file itself says so:
 * Mailchimp exports one CSV per contact type (`subscribed_…`,
 * `unsubscribed_…`, `nonsubscribed_…`, `cleaned_…`) with no status column.
 */
export function guessImportStatusFromFileName(
  fileName: string,
): ContactImportStatus | null {
  const name = normalizeImportHeader(fileName.split(/[\\/]/).pop() ?? "");
  if (/^cleaned/.test(name)) return "bounced";
  if (/^(un|non_?)subscribed/.test(name)) return "unsubscribed";
  if (/^subscribed/.test(name)) return "subscribed";
  return null;
}
