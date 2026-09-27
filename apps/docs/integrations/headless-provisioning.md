# Headless organization setup and team provisioning

This guide configures shared delivery once, then gives an integration such as
CourseLit a separate, narrower key for ongoing team provisioning. The workflow
uses supported REST APIs and works without a dashboard session or copying a
generated key from startup logs.

For the rendered version, see [Headless provisioning](/developers/headless-provisioning).
The machine-readable API contract is available at `GET /openapi.json`; Swagger
UI is at `GET /docs`.

## Credentials and scopes

Organization keys are sent as `Authorization: Bearer <key>`. Keep them in a
server-side secret manager or deployment environment; never put them in
browser or mobile code.

| Key               | Bootstrap display name               | Scopes                                                                              | Use                                                   |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Delivery setup    | `[Auto-generated] Delivery Setup`    | `organization:read`, `esps:read`, `esps:manage`, `delivery:read`, `delivery:manage` | One-time shared ESP and delivery-policy configuration |
| Team provisioning | `[Auto-generated] Team Provisioning` | `organization:read`, `teams:provision`, `teams:read`                                | Ongoing server-to-server team provisioning            |

`delivery:manage` authorizes every field in the delivery-policy update schema,
including shared quotas and team delivery controls—not only the default ESP
and automatic grants. Use it only for trusted setup automation and revoke it
after setup if it is no longer needed.

## Register configured keys in a self-hosted install

Set `BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` to the initial owner's email. It selects
an ordinary organization owner; it does not create a special global-admin
role. Bootstrap finds or creates that user's default organization and
registers any configured keys even when the user already exists. If the user
is not an owner of that organization, key registration fails closed rather
than promoting a member or administrator automatically.

Generate two distinct high-entropy organization keys. For each key, run:

```sh
node -e 'process.stdout.write(`sl_org_live_${require("node:crypto").randomBytes(32).toString("base64url")}\n`)'
```

Copy the generated values to the SendLit Compose `.env`:

```dotenv
BOOTSTRAP_ORGANIZATION_OWNER_EMAIL=admin@example.com
BOOTSTRAP_DELIVERY_SETUP_API_KEY=sl_org_live_<generated-value>
BOOTSTRAP_TEAM_PROVISIONING_API_KEY=sl_org_live_<different-generated-value>
```

Keep both values server-side. The root Compose file passes them only to the
one-shot `init` service and explicitly clears them in the long-running API and
web containers. Pass the delivery key to the one-shot setup client and the
team-provisioning key to the integration's server-side runtime environment.
Never expose either key to browser or mobile clients.

On each bootstrap run, SendLit stores only a SHA-256 hash and display prefix.
The same active key, organization, and exact scopes are an idempotent no-op. A
revoked, expired, cross-organization, invalid-format, or differently scoped
key fails closed; bootstrap will not recreate it or widen its scopes. If the
delivery key has been revoked, unset
`BOOTSTRAP_DELIVERY_SETUP_API_KEY` before the next bootstrap. Keep the
team-provisioning path configured while the integration uses that key.

## Configure shared delivery once

The delivery setup service/job should run explicitly, not on every stack
startup. It should preserve operator changes on reruns. Store the chosen ESP
ID or fail clearly if a configured ESP name matches multiple records; names
are not unique.

Set variables for your API origin, key, and test recipient. The examples below
use a generic SMTP provider; transport host, port, TLS, and credentials are
deployment-specific.

```sh
SENDLIT_API_URL=https://api.sendlit.example
: "${BOOTSTRAP_DELIVERY_SETUP_API_KEY:?Load it from the SendLit .env before running this script}"
: "${BOOTSTRAP_TEAM_PROVISIONING_API_KEY:?Load it from the integration environment}"
TEST_RECIPIENT_EMAIL=operator@example.com
```

Discover the organization bound to the key. The endpoint has no organization
ID input and returns only the caller key's organization:

```sh
ORGANIZATION_RESPONSE="$(curl --silent --show-error --fail-with-body \
  "$SENDLIT_API_URL/provisioning/organization" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY")"
ORGANIZATION_ID="$(printf '%s' "$ORGANIZATION_RESPONSE" | jq -er '.organizationId')"
printf '%s\n' "$ORGANIZATION_RESPONSE" | jq .
```

Example response:

```json
{
    "organizationId": "org_01J...",
    "name": "Example Organization",
    "status": "active",
    "createdAt": "2026-09-01T10:00:00.000Z",
    "updatedAt": "2026-09-01T10:00:00.000Z"
}
```

List organization ESPs with `esps:read` or `esps:manage` and reuse the
intended ESP by its stored public `espId`. If none exists, create one:

```sh
curl --fail-with-body \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/esps" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY"
```

For an unambiguous existing ESP, load its previously stored `espId` into
`ESP_ID`; otherwise create the intended ESP as shown below. Do not select by
name when multiple records share that name.

If creating one, capture its public ID from the response:

```sh
ESP_RESPONSE="$(curl --silent --show-error --fail-with-body --request POST \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/esps" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "name": "Shared delivery",
    "provider": "smtp",
    "host": "smtp.example.net",
    "port": 587,
    "secure": true,
    "username": "smtp-user",
    "password": "<SMTP_SECRET>",
    "fromName": "Example",
    "fromEmail": "mail@example.com"
  }')"
ESP_ID="$(printf '%s' "$ESP_RESPONSE" | jq -er '.espId')"
printf 'Using ESP %s\n' "$ESP_ID"
```

The response includes `espId` and a lifecycle `status` of `draft`; it never
returns the stored provider secret. Save `espId` for subsequent calls.

Example response:

```json
{
    "espId": "esp_01J...",
    "name": "Shared delivery",
    "provider": "smtp",
    "host": "smtp.example.net",
    "port": 587,
    "secure": true,
    "username": "smtp-user",
    "hasPassword": true,
    "fromName": "Example",
    "fromEmail": "mail@example.com",
    "status": "draft",
    "secretVersion": 1,
    "lastTestedAt": null,
    "lastTestStatus": null,
    "lastTestError": null,
    "activatedAt": null,
    "drainUntil": null,
    "retiredAt": null,
    "updatedAt": "2026-09-01T10:02:00.000Z"
}
```

Send a test message with an explicit recipient. Organization-key calls have
no signed-in user's email to use as a fallback:

```sh
curl --fail-with-body --request POST \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/esps/$ESP_ID/test" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY" \
  -H 'Content-Type: application/json' \
  --data "{\"to\":\"$TEST_RECIPIENT_EMAIL\"}"
```

Successful test response: `{"success":true}`.

After a successful test, activate the ESP:

```sh
curl --fail-with-body --request POST \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/esps/$ESP_ID/activate" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY"
```

The activation response is the ESP projection with `status: "active"` and
its public `espId`.

Set it as the default for new teams and enable automatic grants:

```sh
curl --fail-with-body --request PUT \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/delivery-policy" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY" \
  -H 'Content-Type: application/json' \
  --data "{\"defaultEspId\":\"$ESP_ID\",\"autoGrantDefaultEsp\":true}"
```

The response includes `defaultEspId`, `autoGrantDefaultEsp`, the nullable
quota fields, team-delivery defaults, and `updatedAt`, for example:

```json
{
    "defaultEspId": "esp_01J...",
    "autoGrantDefaultEsp": true,
    "defaultDailyLimit": null,
    "defaultMonthlyLimit": null,
    "aggregateDailyLimit": null,
    "aggregateMonthlyLimit": null,
    "teamEspEnabledByDefault": true,
    "teamCanChangeDefault": true,
    "updatedAt": "2026-09-01T10:05:00.000Z"
}
```

The request is validated against the active ESPs owned by that organization.
Owner/admin dashboard sessions continue to work. Organization keys need
`delivery:read` for policy `GET` and `delivery:manage` for policy `PUT`;
`esps:manage` and `grants:manage` do not imply either permission.

Read the current policy before writing it:

```sh
curl --fail-with-body \
  "$SENDLIT_API_URL/organizations/$ORGANIZATION_ID/delivery-policy" \
  -H "Authorization: Bearer $BOOTSTRAP_DELIVERY_SETUP_API_KEY"
```

If a policy is already configured, do not overwrite an operator's later
choices on every application restart. Run setup as an explicit one-shot job
or record a completion marker in the consuming integration; reruns should
confirm the intended ESP ID and skip the write when setup is complete.

After this setup succeeds, revoke the delivery setup key if no further
delivery-policy automation is required. Clear its `BOOTSTRAP_DELIVERY_SETUP_API_KEY`
value from the SendLit Compose environment before the next bootstrap run.

## Provision teams with the runtime key

CourseLit should use only the team-provisioning key at runtime. It does not
need `esps:manage`, `grants:manage`, or delivery-policy authority. Provision
one team per stable external tenant identifier:

```sh
curl --fail-with-body --request POST \
  "$SENDLIT_API_URL/provisioning/teams" \
  -H "Authorization: Bearer $BOOTSTRAP_TEAM_PROVISIONING_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "externalId": "school:school-123",
    "name": "School 123",
    "sender": { "fromName": "School 123" },
    "mailingAddress": "123 Example Street, Example City",
    "delivery": { "useOrganizationDefault": true }
  }'
```

The first response has `created: true` and returns a team API key in `apiKey`;
persist it securely if the integration sends through team-scoped APIs. An
identical retry uses the same `(organization, externalId)` and returns
`created: false` with `apiKey: null`. With automatic grants enabled, a new
team receives the active organization ESP grant and uses it as its default.
The response has this shape on first creation (store the returned team key
immediately):

```json
{
    "teamId": "team_01J...",
    "externalId": "school:school-123",
    "name": "School 123",
    "deliverySource": { "type": "organization" },
    "created": true,
    "apiKey": "sl_live_..."
}
```

An identical replay has `"created": false` and `"apiKey": null`.

See [Provisioning teams](/developers/provisioning) for team lifecycle and
retry behavior.

## Rotation and migration

To rotate a configured key, create a new random key, update its `.env` value,
restart the one-shot bootstrap, switch the consuming integration, verify the
new key, and explicitly revoke the old key. Bootstrap does not automatically
revoke older keys.

For deployments using the old key printed in `init` logs, keep that key active
while registering and verifying `BOOTSTRAP_TEAM_PROVISIONING_API_KEY`.
Switch CourseLit to the new key, then revoke the old broad key from the
dashboard or authenticated API. Do not rely on old logs as the recovery path.

## REST, SDK, and agent integrations

Use `/openapi.json` as the machine-readable source for paths and schemas, or
`/docs` to inspect it interactively. SDK/agent clients should send the
organization key as an HTTP Bearer credential and call REST for organization
bootstrap and delivery policy. Organization keys do not authenticate to MCP;
MCP remains team-scoped (team key or user OAuth).

## Scope boundary

This guide covers the SendLit API and bootstrap contract. A separate consumer
Compose setup owns local transport configuration, such as a Mailpit host,
health checks, and a configurable test recipient. Those are not special
behaviors in SendLit's general REST API.
