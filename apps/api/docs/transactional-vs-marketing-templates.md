# Transactional vs. Marketing Templates — Implementation Plan

## Status

Implemented. This document defines the shipped product and technical boundary
between marketing templates used by broadcasts/sequences and transactional
templates used by `POST /emails`. Verification covers API, Web, generic editor,
footer add-on, Swagger/OpenAPI, MCP, and documentation builds.

## Problem

SendLit currently has one template catalog. Its default and built-in templates
contain the marketing compliance variables `{{address}}` and
`{{unsubscribe_link}}`. The transactional API renders the same saved templates
but intentionally does not provide those marketing-only values. Strict
transactional variable validation therefore reports them as missing.

Passing empty values is not an acceptable fix: it would produce blank addresses
and broken unsubscribe links. Allowing callers to provide these values is also
incorrect because compliance values must be owned by SendLit, not trusted API
input.

## Product decision

Every saved and built-in template has an explicit purpose:

```ts
type TemplatePurpose = "marketing" | "transactional";
```

Use the public property name `purpose`, not `type` or `templateType`. The object
is already known to be a template; `purpose` describes the sending context in
which it is valid.

| Purpose         | Valid send paths                    | SendLit-provided values                                     | Footer   |
| --------------- | ----------------------------------- | ----------------------------------------------------------- | -------- |
| `marketing`     | Broadcasts and sequences            | `subscriber`, `address`, `unsubscribe_link`                 | Required |
| `transactional` | `POST /emails` and MCP `send_email` | None of the marketing values; caller supplies business data | Absent   |

Template purpose is immutable after creation. Changing purpose can silently
change compliance and API behavior, so conversion is performed by duplication.

SendLit continues to require a configured workspace mailing address before any
send as a conservative platform policy. Transactional messages do not render
that address or an unsubscribe footer. This policy is separate from template
rendering.

## Invariants

1. Marketing templates cannot be sent through the transactional API.
2. Transactional templates cannot be selected for broadcasts or sequences.
3. API callers never provide `address` or `unsubscribe_link`.
4. Marketing templates contain exactly one final `footer` block with
   SendLit-controlled address and unsubscribe content.
5. Transactional templates cannot contain a `footer` block.
6. Missing unguarded transactional variables return a synchronous `422`; no
   transactional row or queue job is created.
7. System templates are starters. They must be copied into a team-owned `tpl_`
   template before use by `POST /emails`.
8. Historical email snapshots remain unchanged when a template is edited,
   converted, or deleted.

## 1. Data model and development reset

### Schema

Add `purpose` to `email_templates` in `apps/api/src/db/schema.ts`:

```ts
purpose: text("purpose").notNull().default("marketing");
```

Add a database check constraint limiting the value to `marketing` or
`transactional`. Export one shared TypeScript constant/enum from the API
contract so API, web, and MCP code do not duplicate string literals.

### Development data reset

SendLit is still in early development, so do not build or retain legacy-footer
recognition, backfill, or normalization code. After adding `purpose` and the
footer structure, clear the existing development/test database through the
repository's normal reset workflow and recreate fixtures using the new schema.

The reset must be an explicit development/test operation, not startup behavior
or a production migration. Do not ship application code that silently deletes
template or delivery data. If a deployment contains data that must be retained,
stop and design a migration for that deployment rather than running the reset.

## 2. API contract, Swagger, and public schemas

Update `packages/api-contract/src/schemas/templates.ts`:

- Add `templatePurposeSchema`.
- Add `purpose` to `emailTemplateSchema` and `systemTemplateSchema`.
- Add `purpose` to `createTemplateBodySchema`.
- Do not add `purpose` to `updateTemplateBodySchema`; purpose is immutable.
- Add a computed `requiredVariables: string[]` response field to team and system
  template responses. Always include it, using an empty array when no variables
  are required. Defaults and guarded variables must not appear in this list.
- System-template definitions may additionally provide
  `variableDefinitions: Array<{ path, description, example }>` for documentation
  and generated examples. `requiredVariables` remains the canonical public list
  of required paths and runtime discovery remains authoritative.

Update template endpoints:

- `GET /templates?purpose=marketing|transactional` filters team templates.
- `GET /system-templates?purpose=marketing|transactional` filters starters.
- `POST /templates` accepts `purpose`; during compatibility rollout, omission
  maps to `marketing`.
- `POST /templates/:templateId/duplicate` creates a new template with a new
  title and the source template's purpose. Purpose is never converted.

Add stable mismatch errors:

```json
{
    "error": "template_not_transactional"
}
```

```json
{
    "error": "template_not_marketing"
}
```

Use `422 Unprocessable Entity` because the template exists and the request is
syntactically valid, but it cannot be used by that sending context. Document
these responses in the ts-rest contract so they appear in Swagger.

## 3. Template query and resolution boundaries

Replace the context-free `resolveStartingTemplate(teamId, templateId)` behavior
with purpose-aware resolution, for example:

```ts
resolveStartingTemplate(teamId, templateId, purpose);
getTemplateForPurpose(teamId, templateId, purpose);
```

The resolver must:

- Validate ownership for team templates.
- Validate purpose for both team and system templates.
- Return a typed mismatch result rather than treating a mismatch as not found.
- Preserve existing public `tpl_` and `system:` identifiers.

Broadcast/sequence creation and “add email” paths request `marketing`.
Transactional creation requests `transactional` and only accepts team-owned
templates. System templates remain copyable starters rather than directly
sendable immutable dependencies.

## 4. Rendering and compliance ownership

### Transactional rendering

The transactional path:

1. Resolves a team template with `purpose === "transactional"`.
2. Rejects marketing templates with `422 template_not_transactional`.
3. Passes only caller-provided `variables` to Liquid.
4. Rejects missing unguarded variables using the existing
   `missing_template_variables` response.
5. Allows explicit optional values through a Liquid `default` filter or a
   guarded `{% if value %}` block.
6. Does not inject `address`, `unsubscribe_link`, or `subscriber`.
7. Rejects a `footer` block if one is submitted in transactional content.

When a transactional template is created or updated, reject reserved marketing
variables with a validation error such as:

```json
{
    "error": "marketing_variables_not_allowed",
    "variables": ["address", "unsubscribe_link"]
}
```

This catches incompatible content when it is authored rather than at send time.

### Marketing footer block

Store the required marketing footer directly in the template as a dedicated
email block:

```ts
{
    blockType: "footer",
    settings: {
        alignment: "center",
        fontSize: "12px",
        foregroundColor: "#64748b",
        paddingTop: "16px",
        paddingBottom: "16px"
    }
}
```

The block owns its semantic content. Its settings contain presentation only;
they do not store editable `address` or `unsubscribe_link` text. During preview
and delivery, SendLit renders the workspace address and the appropriate
unsubscribe link inside the block.

#### Package boundary

The `footer` is a SendLit add-on block, not a built-in block or product concept
inside `@sendlit/email-editor`. The editor must remain a generic, independently
hostable WYSIWYG editor that can export HTML without knowing about template
purposes, mailing addresses, unsubscribe rules, or SendLit.

Keep the boundary as follows:

- `@sendlit/email-editor` exposes generic block registration, default settings,
  render-context, and per-block capability hooks such as insertable, deletable,
  duplicable, movable, and placement.
- Implement the SendLit `footer` add-on in
  `packages/email-blocks/src/footer`, expose it through the
  `@sendlit/email-blocks/footer` package subpath, and import that same block from
  `apps/web` and `apps/api`. Add `@sendlit/email-blocks` as an API workspace
  dependency; do not implement separate web and API renderers for the footer.
- `apps/web` registers the add-on only for marketing template editing, supplies
  safe preview values, and uses its capabilities to keep it at the bottom while
  allowing presentation settings to be edited.
- `apps/api` registers the same add-on when rendering stored marketing content
  and independently validates that exactly one valid footer is present.
- Transactional editor and renderer configurations do not register the add-on,
  and API validation rejects stored or submitted transactional content that
  contains `blockType: "footer"`.

Editor capabilities are a UX mechanism, not the compliance boundary. A caller
can construct template JSON without using the editor, so API structural
validation remains mandatory.

Use an additive, backward-compatible generic editor contract:

```ts
type BlockPlacement = "any" | "first" | "last";

interface BlockCapabilities {
    insertable: boolean;
    deletable: boolean;
    duplicable: boolean;
    movable: boolean;
    placement: BlockPlacement;
}

interface BlockComponent<TSettings = unknown, TRenderContext = unknown> {
    block: ComponentType<BlockRenderProps<TSettings, TRenderContext>>;
    settings: ComponentType<BlockSettingsProps<TSettings>>;
    metadata: BlockMetadata;
    defaultSettings?: () => TSettings;
    capabilities?: Partial<BlockCapabilities>;
}
```

All omitted boolean capabilities default to `true`, placement defaults to
`"any"`, and omitted default settings resolve to `{}`. Thread an optional
generic `renderContext` through `EmailEditor`, `BlockRenderProps`,
`EmailTemplate`, and `renderEmailToHtml`; never serialize it into
`Email.content`. Existing custom blocks remain source-compatible through the
generic defaults. Mutation handlers must enforce capabilities themselves;
hiding a toolbar control is not sufficient.

The footer add-on consumes a SendLit-owned context:

```ts
interface SendLitEmailRenderContext {
    footer?: {
        mailingAddress: string;
        unsubscribeUrl: string;
    };
}
```

The web uses the real workspace address and a non-operative safe preview URL.
The API uses the real workspace address and recipient-specific unsubscribe URL.
Missing footer context is a render error for marketing content, not a reason to
render blank values.

For marketing templates:

- Exactly one `footer` block is required, and it must be the final content
  block.
- It remains part of the stored template and the normal editor canvas, so the
  preview is WYSIWYG.
- The editor disables delete and move controls for it.
- Users may edit safe presentation settings such as alignment, color, font
  size, and padding.
- Users cannot edit or remove the required address and unsubscribe content.
- API create/update validation enforces the same rules, preventing direct API
  calls from bypassing the editor.

For transactional templates:

- No `footer` block is added.
- The editor does not offer the block.
- API create/update validation rejects the block.
- `address` and `unsubscribe_link` are absent from the variable palette and
  render context.

### Marketing rendering

The marketing path remains responsible for:

- `subscriber.email`
- `subscriber.name`
- `subscriber.tags`
- `address`
- `unsubscribe_link`

Replace `verifyMandatoryTags`, which searches arbitrary text blocks for merge
tags, with structural validation:

1. Confirm marketing content contains exactly one `footer` block and that it is
   the final content block.
2. Render that block using the configured address and recipient-specific
   unsubscribe URL.
3. Confirm the final output contains both values before transport.
4. Reject reserved footer variables when they appear in ordinary marketing
   blocks, avoiding duplicate or misleading compliance content.

## 5. Built-in template catalogs

Split `apps/api/src/templates/system-templates.ts` into purpose-specific
catalogs or modules while retaining one exported listing API.

### Marketing starters

Keep and classify the existing starters as `marketing`:

- Announcement
- Welcome/newsletter-style campaign
- Upsell
- Newsletter
- Blank marketing email

Existing `system:` IDs should remain valid to avoid breaking saved chooser
state or deep links. Add purpose metadata rather than renaming them unless an
ID is genuinely ambiguous.

### Transactional starters

Add footer-free starters with explicit required-variable metadata:

| Starter              | Example ID                            | Required variables                       |
| -------------------- | ------------------------------------- | ---------------------------------------- |
| OTP                  | `system:transactional:otp`            | `otp`                                    |
| Magic sign-in link   | `system:transactional:magic-link`     | `magic_link`                             |
| Password reset       | `system:transactional:password-reset` | `reset_url`                              |
| Email verification   | `system:transactional:verify-email`   | `verification_url`                       |
| Account invitation   | `system:transactional:invitation`     | `inviter.name`, `invitation_url`         |
| Receipt              | `system:transactional:receipt`        | `order.id`, `order.total`, `order.items` |
| Payment confirmation | `system:transactional:payment`        | `payment.id`, `payment.amount`           |
| Security alert       | `system:transactional:security-alert` | `event`, `occurred_at`                   |
| Blank transactional  | `system:transactional:blank`          | none                                     |

Each system-template definition should include:

```ts
{
    templateId,
    title,
    description,
    purpose,
    content,
    variableDefinitions: [
        { path: "otp", description: "One-time verification code", example: "345987" }
    ]
}
```

The API derives the public `requiredVariables` paths from rendered-template
discovery and uses `variableDefinitions` to enrich documentation and examples.
Runtime validation remains authoritative and must not trust metadata alone.

## 6. Same-purpose duplication

`POST /templates/:templateId/duplicate` creates a team-owned copy of either a
system starter or an existing team template. It assigns a new `tpl_` ID,
preserves the source purpose and content, appends “(Copy)” through the normal
unique-title logic, reconciles media references, and emits an audit/analytics
event. A duplicate can never convert between marketing and transactional.

## 7. Web application UX

### Template hub

- Add `All`, `Marketing`, and `Transactional` filters.
- Display a purpose badge on every card.
- Make “New template” start with a purpose choice, then show only compatible
  system and team templates.
- Provide a secondary, icon-only “Copy template ID” action with a tooltip.
- Add “Duplicate” to the card actions. It creates a same-purpose copy and
  leaves the user in the template hub.

### Editor

Keep the reusable `EmailEditor` purpose-agnostic. Pass purpose into SendLit's
`EmailEditorScreen`, which constructs the appropriate block registry, render
context, and variable palette:

- Marketing: `subscriber.*`; render the required `footer` block in the canvas
  using the real workspace address and a safe preview unsubscribe URL. Disable
  delete/move controls and expose presentation settings only.
- Transactional: show declared/discovered business variables and exclude all
  marketing-only values; do not add or offer the `footer` block.

Display an immutable purpose badge in the editor header. If a user needs the
other purpose, link to duplication rather than offering an in-place switch.

### Choosers

Update `TemplateChooser` to require a purpose and filter defensively even when
the API response is unfiltered. Broadcast and sequence dialogs pass
`marketing`; transactional template creation passes `transactional`.

## 8. Transactional developer experience

For every transactional template, show:

- Copy template ID.
- Required variable paths and descriptions.
- A JSON payload example.
- A ready-to-copy `curl` example using `POST /emails`.
- The `missing_template_variables` response example.

Swagger must document:

- Transactional templates only for `templateId`.
- `422 template_not_transactional`.
- `422 missing_template_variables` with `missingVariables`.
- That inline `html` bypasses template/Liquid rendering.
- That marketing compliance variables are server-owned and unavailable to
  transactional templates.

Update `apps/docs` pages for templates, broadcasts/sequences, transactional
email, and API errors. Update `apps/api/docs/transactional-emails.md` and the
architecture/development-reset notes where applicable.

## 9. MCP changes

Because API changes must remain consistent with MCP:

- `send_email` must reject marketing templates with the same stable error.
- Template list/get/create tools must include and accept `purpose` where those
  tools exist.
- Tool descriptions must state which purpose is valid for each send path.
- Missing-variable MCP errors should list the missing paths.
- Built-in transactional starters and their variable metadata should be
  discoverable rather than requiring agents to guess payload fields.

## 10. Tests

### Database and query tests

- Fresh databases create the constrained `purpose` column correctly.
- Database rejects invalid purpose values.
- Create/list/get responses include purpose.
- Purpose cannot be patched.
- Purpose filters are team-safe.
- Duplication creates a distinct ID and reconciles media references.
- Duplication preserves the source purpose; its request schema provides no
  destination-purpose input.

### Rendering tests

- Marketing context supplies address, unsubscribe URL, and subscriber data.
- Marketing content contains and renders exactly one valid final `footer`
  block.
- Marketing validation rejects a missing footer, duplicate footers, and a
  footer in any position other than last.
- Transactional rendering does not inject marketing values or a footer.
- Transactional templates containing reserved marketing values are rejected.
- Missing unguarded transactional variables return sorted unique paths.
- Defaults and inactive guarded branches remain optional.
- No database row, outbound ledger record, or queue job is created after any
  preflight rejection.

### Route and contract tests

- `POST /emails` rejects marketing templates with the documented `422` body.
- Broadcast/sequence creation rejects transactional templates.
- System and team template listings filter by purpose.
- Swagger/OpenAPI contains purpose fields and all mismatch responses.
- MCP produces behavior equivalent to REST.

### Web tests

- Purpose filters and badges render correctly.
- Choosers never show incompatible templates.
- Editor variable palettes are purpose-specific.
- Duplicate-as flows preserve the original and open the new template.
- Transactional cards expose ID/curl and required-variable information.

### Email editor unit tests

Add tests in `packages/email-editor` for the generic extension behavior:

- A block with `deletable: false` cannot be deleted through controls or editor
  commands.
- A block with `movable: false` cannot be moved through controls or editor
  commands.
- A block with `duplicable: false` does not expose duplication and cannot be
  duplicated through editor commands.
- A block with `insertable: false` is omitted from the add-block picker.
- `placement: "last"` keeps the block final and prevents insertion below it.
- An ordinary final block remains movable and deletable; position alone does
  not lock a block.
- Block-provided default settings are used instead of a core block-type switch.
- Editor preview and HTML rendering receive the caller-provided generic render
  context without persisting it into the email document.

Add integration tests in the SendLit footer add-on and applications:

- `@sendlit/email-blocks/footer` renders the supplied preview address and safe
  unsubscribe URL while persisting presentation settings only.
- Web registers the footer only for marketing templates.
- API and web use the same exported footer implementation.
- API enforcement cannot be bypassed with manually constructed template JSON.

## 11. Rollout sequence

### Phase 1 — Model and development reset

1. Add the database column/check and shared schemas.
2. Update fixtures and reset development/test data; do not add legacy migration
   code.
3. Add purpose to REST, Swagger, MCP, and serialized responses.
4. Keep omitted create purpose defaulting to marketing temporarily.

### Phase 2 — Enforcement and catalogs

1. Make all resolvers purpose-aware.
2. Enforce send-path mismatches.
3. Add transactional built-in starters.
4. Reject reserved marketing variables in transactional templates.
5. Add duplication/conversion behavior.

### Phase 3 — Footer block and rendering

1. Add generic block capability and render-context hooks to
   `@sendlit/email-editor`; remove implicit first/last-block locking.
2. Implement `footer` as a shared SendLit add-on and register the same
   implementation in `apps/web` and `apps/api`.
3. Require exactly one final footer in marketing templates and reject it in
   transactional templates.
4. Replace mandatory-tag string matching with structural and final-output
   validation.

### Phase 4 — Web and documentation

1. Add hub filters, badges, purpose-first creation, and duplication actions.
2. Make editor variables purpose-aware.
3. Add transactional ID, variable schema, and curl UX.
4. Publish developer and API documentation.

### Phase 5 — API compatibility cleanup

After first-party clients send purpose explicitly and have had time to update:

- Consider making `purpose` required for all template creation clients.
- Remove compatibility assumptions around missing purpose.

## Observability

Track without recording variable values or rendered content:

- Template creation counts by purpose.
- Purpose-mismatch rejection counts.
- Missing-variable rejection counts and template ID, but not submitted values.
- Duplicate/conversion events.
- Marketing final-output compliance assertion failures.

Never send template variables, recipient content, mailing addresses, or rendered
HTML to analytics/error-capture systems.

## Acceptance criteria

The work is complete when:

1. A user can create or copy ready-made transactional templates without
   marketing tags.
2. `POST /emails` accepts a transactional template when all required business
   variables are supplied.
3. The same endpoint rejects a marketing template with
   `template_not_transactional`, not misleading missing-variable errors.
4. Broadcasts and sequences cannot use transactional templates.
5. Every marketing template and delivery has exactly one valid final `footer`
   block whose address/unsubscribe content is owned by SendLit.
6. Transactional delivery contains no marketing footer unless the user writes
   ordinary non-reserved content that happens to include contact information.
7. Swagger, MCP, and `apps/docs` describe the same behavior.
8. Development/test reset instructions are explicit, and no legacy recognition
   or destructive production startup behavior is shipped.

## References

- FTC CAN-SPAM compliance guidance:
  https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- SendGrid transactional templates:
  https://www.twilio.com/docs/sendgrid/api-reference/transactional-templates
- Postmark transactional/broadcast message streams:
  https://postmarkapp.com/support/article/how-to-create-and-send-through-message-streams
- Mailchimp Transactional templates:
  https://mailchimp.com/developer/transactional/docs/templates-dynamic-content/
