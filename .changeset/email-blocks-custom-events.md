---
"@sendlit/email-blocks": minor
---

`TriggerPicker` adds the `event:custom` and `contact:property_changed` triggers: a combobox for the event name or custom field (`valueOptions`, `onCreateValue`), a property filter for events (`triggerFilter`, `eventProperties`) or from/to values for field changes, a `valueFooter` slot and `labels` overrides. `onChange` now also returns `triggerFilter`. Also exports `EventPropertyFilterEditor` and `ValueCombobox`, and the `EventDefinition`, `EventPropertyFilter`, `PropertyChangeFilter` and `ReentryMode` types.
