# sendlit

## 0.2.0

### Minor Changes

- 26e4b84: Types for the new API surface: contact import (`contacts.import`) and CSV export (`contacts.export`), sending a test of a sequence email (`sequences.sendEmailTest`), a broadcast's `excludeFilter`, an ESP's `replyTo`, `maxSendRate` and `dailySendLimit`, a transactional send's `text`, and the `starter` plan.
- 88c5b75: Types for the hosted sending safeguards. A sequence (broadcast) can now carry `contentScanVerdict` (`clean`, `review`, `blocked` or `approved`), `pacing` (set while a new hosted account's broadcast is sent gradually) and its `bounceRate` and `complaintRate`. A contact import accepts an optional `source`, such as the CSV file name, which is kept in the audit log. `@sendlit/email-blocks` adds the same fields to its sequence type, plus `autoPause`, which is set when SendLit paused a send because of bounces, complaints, repeated failures or an ESP error.

## 0.1.0

### Minor Changes

- 61c1818: Add `sendlit`, the official server-side TypeScript SDK for the SendLit API. It covers contacts, segments, templates, broadcasts and sequences, transactional emails, team provisioning, suppressions, and delivery events, typed from the API contract, with typed errors and automatic retries.
