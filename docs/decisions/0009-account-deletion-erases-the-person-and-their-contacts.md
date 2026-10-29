# ADR 0009: Account deletion erases the person and their contacts' data

Status: accepted
Date: 2026-10-29

## Context

GDPR's right to erasure (Art. 17) means a person must be able to delete
their SendLit account and the data that comes with it (#134). An account
owns organizations, and an organization holds the personal data of its
contacts. For that data the customer is the controller and SendLit the
processor, and a processor deletes the controller's personal data when the
service ends (Art. 28(3)(g)).

Deleting an organization (#151) only closes it: billing, audit, delivery
reporting and suppressions stay, and so do its contacts. That is right
while the owner's account exists, because they may come back, but not when
the owner is gone and nobody can reach the data any more.

Better Auth has a `deleteUser` endpoint, but it hard-deletes the `user` row.
Billing subscriptions, trial claims (`trial_claims.user_id` is `RESTRICT`)
and audit events refer to the user id, and some of them have to be kept
(see below). GitHub, Stripe and Mailchimp all ask you to re-authenticate,
list what will happen, and refuse while you still own a paid or shared
workspace.

## Decision

- **Where and how.** Account → Danger zone. The dialog lists every
  organization and what happens to it, then asks the person to type their
  email and enter a code emailed to them (Better Auth's email OTP,
  `email-verification` type, reserved for this). The API
  (`GET /account/deletion`, `POST /account/deletion/code`, `DELETE /account`)
  accepts dashboard sessions only, with the same origin and CSRF checks as
  billing actions. MCP and API keys can't delete an account.
- **Blockers.** Nothing changes while any of these hold, and the dialog
  says what to do about each:
  - an organization they are the last owner of has a running or
    paid-through subscription, or an open checkout: cancel it first. We
    never cancel billing on the person's behalf;
  - they are the last owner and other people are members: make someone
    else an owner, or remove them;
  - they pay for a running subscription of an organization they would
    leave.
- **Organizations they are the last owner of** are deleted with
  `deleteOrganization` (keys, domains, ESPs, MediaLit files, ADR 0006),
  and then the personal data the organization holds about its contacts is
  erased (`eraseOrganizationPersonalData`): contacts with everything that
  cascades from them (custom field values, events, enrolments,
  per-contact delivery rows), signup confirmations, recipient addresses
  and rendered bodies of transactional email, recipient addresses on
  outbound messages, delivery events and suppressions, raw ESP webhook
  payloads, last-seen event properties and reputation connections. An
  organization deleted earlier, of which they are still the last owner, is
  erased the same way.
- **Suppression hashes stay.** The versioned HMAC on each suppression row is
  not personal data on its own and keeps an address blocked if the same
  list is imported again into a reused team. The `anonymizeRecipient…`
  helpers in `delivery-feedback/retention.ts` already do exactly this.
- **Shared organizations** keep everything; the person only leaves them and
  their teams. An audit event `organization.member_account_deleted` records
  the opaque user id. Team API keys they created belong to the team and keep
  working.
- **The person.** Sessions, sign-in methods (`account`), OAuth tokens,
  consents and clients they registered, and pending codes are deleted, so
  they are signed out everywhere. The `user` row stays as a tombstone: name
  "Deleted user", email `deleted-<id>@deleted.invalid`, `deleted_at` set.
  `resolve-auth` and `ensureDefaultOrganization` refuse a deleted user, so
  an unexpired OAuth access token stops working at once. Abuse flags drop
  the email and IP from their details.
- **Kept, with an opaque id only:** billing records (tax and accounting
  law), trial claims (their keyed email fingerprint stops the same email
  getting a second free trial, a legitimate interest), organization audit
  events, aggregate reporting and the closed organization itself.
- **Signing up again** with the same email creates a new, empty account
  and organization.
- **No later purge job.** Erasure runs in the request, in bounded batches
  for contacts. The closed organization's remaining rows hold no personal
  data, so there is nothing for a background job to finish. MediaLit
  failures already retry on the media deletion queue.
- **Telemetry.** `account_deleted` with the user id and counts only. Our
  observability package has no PostHog person deletion; the browser resets
  its PostHog identity after the delete. Deleting the PostHog person is a
  follow-up for when `@codelitdev/observability` supports it.

## Consequences

- An account delete can be slow for very large lists, because contacts are
  deleted in the request. If that becomes a problem, the erasure can move
  to a queue without changing the API.
- If billing changes between the preview and the delete, organizations
  deleted before the blocking one stay deleted and the request returns
  `409 account_deletion_blocked`; retrying after resolving it finishes the
  job.
- `user.deleted_at` is nullable and additive, so the previous release keeps
  working against the migrated schema.
