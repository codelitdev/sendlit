# Team provisioning

This document describes the provisioning behavior implemented today and the
product boundary it creates for embedding products such as FrontLit. It is a
short orientation for maintainers; the executable contract remains
`packages/api-contract/src/contract.ts`, and the implementation remains
`apps/api/src/provisioning/routes.ts`.

## Mental model

- An **organization** is the administrative and provisioning boundary. It owns
  teams, organization API keys, organization ESPs, grants, policies, and
  organization-level audit events.
- A **team** is the email-data boundary. Contacts, segments, templates,
  broadcasts, sequences, transactional email, team ESPs, settings, and team
  API keys belong to one team.
- Every team has one required `organizationId`. A team cannot belong to or be
  shared by multiple organizations. There is currently no public team-transfer
  API.
- Human organization membership and human team membership are independent.
  Organization membership does not grant access to team data, and team
  membership does not grant organization administration.
- Organization keys and team keys are different principals. An organization
  key provisions and manages resources within one organization according to
  its scopes. A team key accesses one fixed team's product APIs.

## What provisioning does

Provisioning is a server-to-server API for a multi-tenant product to create
one SendLit team per external tenant inside an existing SendLit organization.
The organization is derived exclusively from the organization API key; it
cannot be selected in the request.

```http
POST /provisioning/teams
Authorization: Bearer sl_org_live_...
Content-Type: application/json

{
  "externalId": "fl_team_...",
  "name": "Acme",
  "sender": {
    "fromName": "Acme",
    "replyTo": "hello@acme.example"
  },
  "mailingAddress": "...",
  "delivery": {
    "useOrganizationDefault": false,
    "teamEspEnabled": true,
    "teamCanChangeDefault": true
  },
  "quota": {
    "dailyLimit": 500,
    "monthlyLimit": 10000
  }
}
```

The call requires an organization key with `teams:provision`. It creates the
team and its general settings, delivery settings, optional organization ESP
grant/quota, and initial team API key. The organization always comes from the
authenticated key, never from `organizationId` in a body or header.

Provisioning does **not**:

- create an organization;
- create a Better Auth user/account;
- interpret an email address as a SendLit identity;
- create organization or team membership; or
- give the organization key implicit access to the team's contacts or other
  team data.

There is no deployment-wide provisioning secret or special provisioning
header. The former global-secret mechanism has been removed; do not
reintroduce it in code, configuration, OpenAPI, or consumer integrations.

## Idempotency and key handling

Idempotency is scoped by `(organizationId, externalId)`. Consequently, two
organizations may use the same external ID, but one organization cannot create
two provisioned teams with the same external ID.

The implementation stores a SHA-256 hash of `JSON.stringify(body)` as the
creation-request hash:

- the first request creates the team and returns `created: true` with the only
  plaintext copy of the initial team API key;
- an identical replay returns the existing team with `created: false` and
  `apiKey: null`;
- a replay for the same external ID with a different creation payload returns
  `409 provisioning_conflict` and does not mutate the team; intentional
  changes must use the lifecycle `PATCH` endpoint; and
- concurrent identical requests converge on one team through the database
  uniqueness constraint and race recovery in the query layer.

Consumers must persist the initial key immediately and encrypted at rest.
SendLit stores only its hash and cannot recover the plaintext. If the key is
lost, `POST /provisioning/teams/:teamId/keys` creates a replacement and revokes
the active keys previously created by organization-key provisioning.

## Lifecycle API and scopes

All provisioning lifecycle routes resolve the team inside the organization
identified by the caller's key. A team from another organization is not
addressable through that key.

| Operation                                  | Required scope    | Behavior                                                          |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------------- |
| `POST /provisioning/teams`                 | `teams:provision` | Idempotently create a team and its initial key                    |
| `GET /provisioning/teams/:teamId`          | `teams:read`      | Read the provisioned team view                                    |
| `PATCH /provisioning/teams/:teamId`        | `teams:manage`    | Update name, sender, mailing address, delivery controls, or quota |
| `POST /provisioning/teams/:teamId/keys`    | `teams:keys`      | Replace organization-created integration keys                     |
| `POST /provisioning/teams/:teamId/suspend` | `teams:manage`    | Stop new sends                                                    |
| `POST /provisioning/teams/:teamId/resume`  | `teams:manage`    | Resume new sends                                                  |
| `DELETE /provisioning/teams/:teamId`       | `teams:manage`    | Soft-archive the team                                             |
| `GET /provisioning/teams/:teamId/usage`    | `usage:read`      | Read daily and monthly quota windows                              |

Provision, update, key rotation, suspension, resumption, and archival are
written to the organization audit log. The `/provisioning` router is currently
rate-limited to 30 requests per minute per source IP.

## FrontLit integration

FrontLit uses one dedicated SendLit organization and stores a scoped
organization key as `SENDLIT_ORGANIZATION_API_KEY`. Every FrontLit team is
eagerly mapped 1:1 to a SendLit team using the FrontLit team's public ID as
`externalId`.

```text
FrontLit SendLit organization
├── FrontLit team A -> SendLit team A -> contacts, newsletters, email data
└── FrontLit team B -> SendLit team B -> contacts, newsletters, email data
```

FrontLit encrypts the returned team API key in its per-team `integrations`
record and uses it for all subsequent calls. Browsers never receive this key.
FrontLit is a thin proxy for newsletter functionality, while SendLit remains
the system of record for contacts and email data. Therefore, exposing the same
underlying team in SendLit's own UI requires no contact migration or copying.

FrontLit currently carries `ownerEmail` in its local provisioning retry job,
but it does not send that value in the SendLit provisioning request. It has no
identity or membership effect in SendLit.

## Direct SendLit access for an embedded customer

This user-facing handoff is **not implemented today**. Signing up for SendLit
with the same email used in FrontLit does not grant access to the provisioned
team. A new SendLit user receives a personal default organization, while the
FrontLit-provisioned team still has no human membership.

Do not solve this by adding the customer to FrontLit's SendLit organization.
Any organization member can enumerate that organization's teams, which would
expose other FrontLit customer workspaces. The intended boundary is direct
membership in only the relevant team.

The recommended future flow is:

1. An authenticated FrontLit user selects **Open in SendLit**.
2. FrontLit requests a short-lived, single-use invitation/handoff for the
   exact provisioned team using its organization credential.
3. SendLit authenticates the person, preferably through **Continue with
   FrontLit** SSO or otherwise through a verified email flow.
4. Accepting the handoff creates an `admin` (or explicitly chosen) membership
   in that team only. It creates no organization membership.
5. SendLit selects that team and opens its dashboard. Existing contacts,
   broadcasts, and settings are immediately present because it is the same
   team, not an imported copy.

The handoff must be bound to the exact team and intended identity, expire
quickly, be single-use, and be audited. Same-email string matching alone is
not sufficient authorization, particularly for shared addresses such as
`hi@example.com`. FrontLit must never expose the stored team API key to achieve
this flow.

Useful API work for this flow would include team invitation creation and
acceptance, team-member listing/revocation, and possibly a dedicated
least-privilege organization-key scope for membership management. The schema
already supports team membership, but the public team invitation/claim
workflow does not yet exist.

## Ownership decision

The current architecture supports an **embedded/add-on** model: FrontLit owns
the SendLit organization, and its customer receives access to one or more
specific teams. This is the smallest and safest path to offering SendLit's
advanced sequence and transactional-email UI over the customer's existing
newsletter data.

It does not yet support converting that workspace into an independently owned
SendLit organization. If customers must retain the workspace after leaving
FrontLit, the product needs an explicit, audited team-transfer capability or a
different model in which each customer organization is created independently
from the beginning. Provisioning alone cannot provide that ownership change.
