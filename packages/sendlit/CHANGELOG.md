# sendlit

## 0.2.0

### Minor Changes

- 26e4b84: Types for the new API surface: contact import (`contacts.import`) and CSV export (`contacts.export`), sending a test of a sequence email (`sequences.sendEmailTest`), a broadcast's `excludeFilter`, an ESP's `replyTo`, `maxSendRate` and `dailySendLimit`, a transactional send's `text`, and the `starter` plan.

## 0.1.0

### Minor Changes

- 61c1818: Add `sendlit`, the official server-side TypeScript SDK for the SendLit API. It covers contacts, segments, templates, broadcasts and sequences, transactional emails, team provisioning, suppressions, and delivery events, typed from the API contract, with typed errors and automatic retries.
