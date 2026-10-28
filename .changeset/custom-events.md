---
"sendlit": minor
---

Adds custom events. `sendlit.events.track()` records an event for a contact and starts every active sequence triggered by it, with `idempotencyKey`, `backfill`, `createContact` and `contact` options; calls with an `idempotencyKey` are retried on 5xx and network errors. `sendlit.events.definitions` lists, gets, creates, updates and deletes the team's event definitions, and `sendlit.contacts.events()` lists the events a contact sent.
