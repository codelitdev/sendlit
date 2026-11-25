---
title: Provisioning teams
description: Create and manage organization-scoped SendLit teams for external tenants.
nav_order: 90
---

Provisioning lets a trusted multi-tenant platform create one isolated SendLit
team for each of its own tenants. For example, a website platform can provision
one SendLit team for every customer workspace and use that team for contacts,
newsletters, sequences, and transactional email.

Provisioning is a backend-to-backend workflow. If you only need another team
for people already using the SendLit dashboard, create it from the dashboard
instead.

For an entirely headless setup—including discovering the key's organization,
configuring an organization ESP, and setting shared delivery for new teams—use
the [Headless organization setup](/docs/developers/headless-provisioning) guide.

Provisioning and organization API keys are available on **Business** cloud
plans and on **OSS**. After a downgrade to Pro or Free, existing organization
keys remain stored for audit and revocation, but mutating provisioning
operations (`provision`, update, rotate keys, suspend, resume, archive) return
`plan_feature_unavailable`. Idempotent replay of an already-provisioned
`(externalId)` still succeeds.

## How provisioning is scoped

Every SendLit team belongs to exactly one organization. The organization API
key used for the request determines that organization; an organization ID in a
request body or header cannot override it.

Provisioning creates the team, its delivery settings, and an initial
team-scoped API key. It does not:

- create an organization;
- create a SendLit user account;
- create organization or team membership; or
- interpret an owner email as authorization.

An organization key manages provisioning. The returned team key accesses that
one team's contacts and email APIs. Keep these credentials separate.

## Prerequisites

1. Create or select a SendLit organization from the
   [Organizations](/docs/workspace/organizations) page.
2. Decide how new teams will deliver email:
    - For shared delivery, add and activate an organization mailbox and select
      it as the default. Enable automatic grants if requests will omit an
      explicit `useOrganizationDefault` choice.
    - For customer-owned delivery, enable team ESPs. The provisioned team can
      configure its own provider later using its team key or the dashboard.
3. Create an organization API key and store its plaintext value in your
   backend secret manager. It is displayed only once. For a team-provisioning
   integration, use `organization:read`, `teams:provision`, `teams:read`, `teams:manage`, `teams:keys`, and `usage:read`;
   do not give its runtime key delivery administration scopes.

Use the minimum scopes your integration needs:

| Scope             | Allows                                       |
| ----------------- | -------------------------------------------- |
| `teams:provision` | Provision a team                             |
| `teams:read`      | Read provisioned team state                  |
| `teams:manage`    | Update, suspend, resume, or archive teams    |
| `teams:keys`      | Replace a provisioned team's integration key |
| `usage:read`      | Read team quota usage                        |

`organization:read` also enables `GET /provisioning/organization`, which
returns the organization bound to the key. One-time shared-delivery setup uses
a separate key; see the headless setup guide for its scopes and lifecycle.

The examples below use:

```bash
SENDLIT_API_URL=https://api.sendlit.app
SENDLIT_ORGANIZATION_API_KEY=sl_org_live_...
```

Never put the organization key in browser code or a mobile application.

## Provision your first team

Use an immutable identifier from your own database as `externalId`. A tenant,
workspace, or account ID is appropriate. Do not use an email address, mutable
slug, or display name.

```bash
curl --request POST "$SENDLIT_API_URL/provisioning/teams" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "externalId": "workspace_01JABCDEF",
    "name": "Acme",
    "sender": {
      "fromName": "Acme",
      "replyTo": "hello@acme.example"
    },
    "postalAddress": {
      "line1": "123 Main Street",
      "city": "Bengaluru",
      "region": "Karnataka",
      "postalCode": "560001",
      "country": "IN"
    },
    "delivery": {
      "useOrganizationDefault": true,
      "teamEspEnabled": false,
      "teamCanChangeDefault": false
    },
    "quota": {
      "dailyLimit": 500,
      "monthlyLimit": 10000
    }
  }'
```

`externalId` and `name` are required. The other fields are optional:

- `sender.fromName` and `sender.replyTo` configure the team's organization
  delivery grant.
- `postalAddress` is the physical address used in managed marketing footers:
  `line1` (street), optional `line2`, `city`, `region` and `postalCode`, and
  `country` as an uppercase ISO 3166-1 alpha-2 code. An unknown country is
  `400 postal_country_invalid`. The lifecycle `PATCH` takes the same object, or
  `null` to clear it.
- `delivery.useOrganizationDefault` grants the active default organization
  mailbox and selects it for delivery. This requires an active default mailbox.
  If this property is omitted, the organization's automatic-grant policy
  supplies the default.
- `delivery.teamEspEnabled` controls whether the team may add its own ESP.
- `delivery.teamCanChangeDefault` controls whether the team may change its
  delivery default.
- `quota.dailyLimit` and `quota.monthlyLimit` constrain the team's use of the
  shared organization mailbox. Use `null` for no per-team limit.

For a team that will connect its own ESP, omit `sender` and `quota`, set
`useOrganizationDefault` to `false`, and set `teamEspEnabled` to `true`.

### Creation response

The first successful request returns `created: true` and the only plaintext
copy of the initial team API key:

```json
{
    "teamId": "team_01JXYZ",
    "externalId": "workspace_01JABCDEF",
    "name": "Acme",
    "deliverySource": {
        "type": "organization"
    },
    "created": true,
    "apiKey": "sl_live_..."
}
```

Before acknowledging the operation in your own application, persist:

```text
external_tenant_id
sendlit_team_id
encrypted_sendlit_team_api_key
sendlit_provisioned_at
```

Encrypt the team key at rest. SendLit stores only its hash and cannot return
the plaintext later.

## Use the team key

Use the returned `sl_live_...` key in the `x-sendlit-apikey` header for
team-scoped APIs. Do not continue using the organization key for contacts or
email content.

```bash
curl "$SENDLIT_API_URL/contacts" \
  --header "x-sendlit-apikey: $SENDLIT_TEAM_API_KEY"
```

The team key resolves exactly one team, so a request cannot use it to read
another tenant's data.

## Retry provisioning safely

Provisioning uses `(organization, externalId)` as its idempotency identity; it
does not use an `Idempotency-Key` header. Retry a failed or timed-out request
with the same `externalId` and the same creation payload.

An identical replay returns the existing team without revealing its key:

```json
{
    "teamId": "team_01JXYZ",
    "externalId": "workspace_01JABCDEF",
    "name": "Acme",
    "deliverySource": {
        "type": "organization"
    },
    "created": false,
    "apiKey": null
}
```

If the same `externalId` is replayed with different creation input, SendLit
returns:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "provisioning_conflict"
}
```

This protects retries from silently changing a tenant. Use
`PATCH /provisioning/teams/:teamId` for intentional changes.

Retry network failures, `429`, and `5xx` responses with exponential backoff and
jitter. Do not automatically retry validation, authorization, or conflict
responses. The provisioning API is currently limited to 30 requests per
minute per source IP.

If SendLit created the team but your platform failed before storing the
plaintext key, the retry correctly returns `apiKey: null`. Replace the lost key
using the organization credential as described below.

## Read and update a provisioned team

Read the current provisioned-team view with a `teams:read` organization key:

```bash
curl "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

The response includes the team's sending `health`:

```json
{
  "health": {
    "status": "marketing_paused",
    "reason": "shared_esp_team_breach",
    "scope": "team",
    "last7Days": { "sent": 1840, "bounced": 92, "complained": 1 }
  }
}
```

- `status` is `normal`, `warned`, `marketing_paused` (broadcasts and sequences
  are held; transactional email still sends) or `all_paused`.
- `reason` is the code behind it, such as `shared_esp_team_breach` when the
  team's own bounces paused it on the shared mailbox.
- `scope` says where the status comes from: `team` for this team's own sends,
  or `shared_mailbox` when the whole mailbox is paused. It's `null` while the
  team is healthy.
- `last7Days` counts the emails the ESP accepted over the last 7 days, and how
  many of them bounced or were marked as spam.

See [Sending safeguards](/docs/self-hosting/sending-safeguards) for what
triggers each status and how it clears.

Update mutable settings with `teams:manage`:

```bash
curl --request PATCH \
  "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "Acme Cloud",
    "sender": {
      "fromName": "Acme Cloud",
      "replyTo": "support@acme.example"
    },
    "quota": {
      "monthlyLimit": 25000
    }
  }'
```

The patch endpoint can change the name, sender, mailing address, team-delivery
controls, and shared-delivery quotas. It cannot change `externalId`, move the
team to another organization, or update an archived team. Sender and quota
updates require an organization delivery grant.

## Replace a lost or exposed team key

Use an organization key with `teams:keys`:

```bash
curl --request POST \
  "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ/keys" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{ "name": "FrontLit production" }'
```

The `201` response contains the new plaintext secret in `key`:

```json
{
    "keyId": "key_01JNEW",
    "keyPrefix": "sl_live_a1b2",
    "name": "FrontLit production",
    "expiresAt": null,
    "lastUsedAt": null,
    "revokedAt": null,
    "createdAt": "2026-08-12T10:00:00.000Z",
    "key": "sl_live_..."
}
```

This operation revokes the team's active keys previously created through
organization-key provisioning. Store the replacement immediately and update
your workers together; requests using a revoked key will fail.

## Suspend, resume, and archive

Suspend new sends while retaining the team and its data:

```bash
curl --request POST \
  "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ/suspend" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

Only an active team can be suspended. Resume a suspended team with:

```bash
curl --request POST \
  "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ/resume" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

Invalid transitions return `409 invalid_lifecycle_transition`.

Archive a tenant with:

```bash
curl --request DELETE \
  "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

Archival is a soft deprovisioning operation and returns `204 No Content`. The
provisioning API does not provide an unarchive operation, so do not archive a
team as a temporary sending pause.

## Read shared-delivery usage

With `usage:read`, retrieve the team's daily and monthly organization-delivery
quota windows:

```bash
curl "$SENDLIT_API_URL/provisioning/teams/team_01JXYZ/usage" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

```json
{
    "health": {
        "status": "normal",
        "reason": null,
        "scope": null,
        "last7Days": { "sent": 2310, "bounced": 18, "complained": 0 }
    },
    "day": {
        "limit": 500,
        "accepted": 120,
        "reserved": 8,
        "remaining": 372,
        "resetsAt": "2026-08-13T00:00:00.000Z"
    },
    "month": {
        "limit": 10000,
        "accepted": 2740,
        "reserved": 8,
        "remaining": 7252,
        "resetsAt": "2026-09-01T00:00:00.000Z"
    }
}
```

`accepted` has already consumed quota. `reserved` represents work accepted by
SendLit but not yet finalized. `health` is the same as on the team. This
endpoint requires an active organization delivery grant for the team.

### Every team in one call

To check all your teams at once, read the organization's mail activity with
the same `usage:read` key:

```bash
curl "$SENDLIT_API_URL/organizations/org_01JXYZ/mail-activity?rangeDays=7" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY"
```

Each entry in `teams` carries the team's mail counts for the window (`sent`,
`queued`, `failed`, `bounced`, `complained`, covering broadcasts, sequences and
transactional email), its `health`, and its `quota` (`day` and `month`, or
`null` when the team has no active organization delivery grant).

## Errors

Error responses contain a stable `error` value. Branch on that value rather
than a human-readable message.

| Status | Error                          | Meaning                                               |
| ------ | ------------------------------ | ----------------------------------------------------- |
| `400`  | validation error               | The request body is invalid                           |
| `401`  | authentication error           | The Bearer credential is missing or invalid           |
| `403`  | `organization_key_required`    | The caller used a user session or team key            |
| `403`  | `organization_scope_required`  | The organization key lacks the route's scope          |
| `404`  | `team_not_found`               | The team does not exist inside the key's organization |
| `409`  | `provisioning_conflict`        | The external ID exists with different creation input  |
| `409`  | `invalid_lifecycle_transition` | The requested status transition is not allowed        |
| `429`  | `too_many_requests`            | The provisioning rate limit was exceeded              |
| `500`  | `server_error`                 | SendLit could not complete provisioning               |

A team's own sends can also be refused while it's paused. A broadcast or
sequence through the shared mailbox returns `403 sending_paused` with `reason`
`shared_esp_team_breach` or `shared_esp_top_contributor` (`scope: "team"`) when
that team's bounces or complaints put the mailbox at risk, or
`shared_esp_breach` (`scope: "shared_mailbox"`) when every team on it is
paused. Transactional email is not affected. See
[Shared mailboxes](/docs/workspace/acceptable-use#shared-mailboxes).

Treat a `404` as organization-scoped: a valid team belonging to another
organization is intentionally not exposed through the caller's key.

## Human access is separate

Provisioning creates an API-accessible team, not a human SendLit account.
Signing up for SendLit later with an email used by the embedding platform does
not automatically grant access to the provisioned team. Human access requires
explicit team membership. Provisioning does not currently expose a public
human invitation or account-claim flow. Organization membership must not be
used as a shortcut because it can reveal other teams in the platform's
organization.

See [Authentication](/docs/developers/authentication) for credential types,
[API keys](/docs/developers/api-keys) for team-key handling, and the
[API reference](https://docs.sendlit.app/api-reference/) for the exhaustive request and response
schemas.
