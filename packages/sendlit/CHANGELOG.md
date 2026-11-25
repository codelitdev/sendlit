# sendlit

## 0.6.0

### Minor Changes

- 46b4f6d: See which recipients bounced or complained from a broadcast or sequence:

  - SDK: `sequences.deliveries(sequenceId, { outcome })` and `sequences.listAllDeliveries()` list each send with its outcome, bounce type, the ESP's reason and the address's suppression. Contact deliveries now include `messageId` and `outcome`.
  - `SequenceAnalyticsMetric` takes `onSelect` and `selectLabel`, which render the value as a button. `sequenceStatsMetrics` takes `onViewBounced` and `onViewComplained` to open the recipients behind the bounce and complaint rates.
  - The bounce and complaint tooltips say sending only pauses once 100 emails have gone out.

- d9e1983: A team's mailing address is now a structured postal address. **Breaking:** the free-text `mailingAddress` field is gone.

  - `@sendlit/email-blocks/postal-address`, a React-free entry point: the `PostalAddress` type, `POSTAL_COUNTRY_CODES` (the 249 current ISO 3166-1 alpha-2 codes), `postalCountryName(code, locale?)`, `isPostalCountryCode(code)` and `formatPostalAddress(address)`, which turns an address into the footer text SendLit sends.
  - `marketingPreviewContext()` takes `postalAddress` and shows it formatted as sent emails do.
  - SDK: `settings.general.get()` returns `{ postalAddress, updatedAt }` and `settings.general.update()` takes `{ postalAddress }` (`null` clears it); `mailingAddress` is removed from both. Provisioning takes and returns `postalAddress` instead of `mailingAddress` in `provisionTeam`, `getTeam` and `updateTeam`. An unknown country is a 400 `postal_country_invalid`. New `PostalAddress` type.

## 0.5.0

### Minor Changes

- 7371201: Add `tags` (list, references, rename, remove), `settings.general` (get, update), `overview.get`, and `sequences.sendEmailTest`, so platforms can manage tags, set the mailing address, show dashboard numbers and send test emails without calling the API by hand.
- bc370d1: `emails.send` takes an optional `fromName`, the From name for that email instead of the delivery source's. The address stays the delivery source's verified one.

## 0.4.0

### Minor Changes

- 3ff09da: Draft and publish for broadcast and sequence emails. While a broadcast or sequence is active (a running sequence or a scheduled broadcast), `sequences.updateEmail` saves subject and content changes as a draft (the email's `draft`, with `hasUnpublishedChanges` on the email and the sequence) and sends keep using the published version. New methods: `sequences.publishChanges` (with `scope: "in_flight" | "new_entrants"` for sequences), `sequences.discardChanges`, `sequences.emailVersions` and `sequences.restoreEmailVersion`. `@sendlit/email-blocks` adds `draft` and `hasUnpublishedChanges` to its sequence types.

## 0.3.0

### Minor Changes

- 902cd16: Adds custom events. `sendlit.events.track()` records an event for a contact and starts every active sequence triggered by it, with `idempotencyKey`, `backfill`, `createContact` and `contact` options; calls with an `idempotencyKey` are retried on 5xx and network errors. `sendlit.events.definitions` lists, gets, creates, updates and deletes the team's event definitions, and `sendlit.contacts.events()` lists the events a contact sent.
- db0c687: A broadcast or sequence has a `viewInBrowser` setting. It is on for broadcasts and off for sequences created from now on; existing sequences keep it on. Turning it off sends its emails without the "View in browser" link and takes down the hosted web versions behind links already sent. `@sendlit/email-blocks` adds `viewInBrowser` to its sequence type.

## 0.2.0

### Minor Changes

- 26e4b84: Types for the new API surface: contact import (`contacts.import`) and CSV export (`contacts.export`), sending a test of a sequence email (`sequences.sendEmailTest`), a broadcast's `excludeFilter`, an ESP's `replyTo`, `maxSendRate` and `dailySendLimit`, a transactional send's `text`, and the `starter` plan.
- 88c5b75: Types for the hosted sending safeguards. A sequence (broadcast) can now carry `contentScanVerdict` (`clean`, `review`, `blocked` or `approved`), `pacing` (set while a new hosted account's broadcast is sent gradually) and its `bounceRate` and `complaintRate`. A contact import accepts an optional `source`, such as the CSV file name, which is kept in the audit log. `@sendlit/email-blocks` adds the same fields to its sequence type, plus `autoPause`, which is set when SendLit paused a send because of bounces, complaints, repeated failures or an ESP error.

## 0.1.0

### Minor Changes

- 61c1818: Add `sendlit`, the official server-side TypeScript SDK for the SendLit API. It covers contacts, segments, templates, broadcasts and sequences, transactional emails, team provisioning, suppressions, and delivery events, typed from the API contract, with typed errors and automatic retries.
