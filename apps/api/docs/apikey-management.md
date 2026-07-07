# API Key Management

A refresher on how SendLit API keys are implemented. For the user-facing view,
see `apps/docs/content/docs/developers/authentication.mdx`.

## Key format

A key is `sl_live_` followed by 32 CSPRNG bytes encoded as base64url (43
chars, 256 bits of entropy), generated in `src/apikey/secret.ts`:

```
sl_live_3xKf9q2mVbA7cD1eF8gH4iJ6kL0nP5rS9tU2wX7yZ4o
```

The Stripe-style `sl_live_` prefix exists for practical reasons, not
aesthetics:

- secret scanners (e.g. GitHub secret scanning) can recognize a leaked
  SendLit key by pattern;
- the credential type is obvious at a glance without exposing the secret.

## Storage: hashed, never plaintext

The `api_keys` table (`src/db/schema.ts`) does **not** store the secret.
It stores:

| column       | contents                                               |
| ------------ | ------------------------------------------------------ |
| `id`         | UUID — how a key is referenced (listing, revocation)   |
| `key_hash`   | SHA-256 hex of the secret, unique — what auth looks up |
| `key_prefix` | first 12 chars (`sl_live_a1b2`) — display only         |
| `team_id`    | the one team this key authenticates as                 |
| `name`       | human label ("Default", "Zapier", ...)                 |

A plain SHA-256 (not bcrypt/argon2) is deliberate: the secret is already 256
bits of CSPRNG output, so brute-forcing the hash is infeasible, and a slow
KDF would only add latency to every authenticated request.

Consequence: **the plaintext secret exists only in the response that creates
the key.** It can never be re-read, re-listed, or recovered — only revoked
and replaced.

## Scoping

A key authenticates as exactly one team, never an account. A team can hold
several independently named/revocable keys (one per integration) without any
of them being able to see another team the owning account belongs to. For the
same reason, team management routes (`src/team/routes.ts`) reject API-key
auth entirely and require an OAuth session.

## Lifecycle

**Create** — `createApiKey(teamId, name)` (`src/apikey/queries.ts`) generates
the secret, stores hash + prefix, and returns `{ apiKey, secret }`. The
secret surfaces exactly once, through whichever surface created it:

- `POST /teams/:teamId/keys` → response's `key` field (contract:
  `createdApiKeySchema`);
- MCP tool `create_api_key`;
- `POST /provisioning/teams` → `apiKey` field, **only on the call that
  actually created the team** (provisioning is idempotent per `externalId`;
  repeat calls return the team with no key, since the hash can't be
  reversed — the consumer must persist it on first provision);
- boot-time super admin (`src/bootstrap.ts`) → logged once so an operator can
  grab it from `docker compose logs`.

`createTeam` (`src/team/queries.ts`) can also mint a "Default" key as part of
creating the team, via `withDefaultApiKey: true` — its one-time secret
propagates up as `defaultApiKeySecret` on the returned team, and from
`createAccount` as well (which forwards its own `withDefaultApiKey` param).
This defaults to `false` and is opt-in, precisely because it's only useful to
callers with an actual way to hand that secret to someone: provisioning
(response body) and boot-time super admin (startup log). Dashboard-driven
team creation (signup, `POST /teams`, MCP `create_team`) leaves it `false` —
otherwise the key would be minted with no way for the user to ever see its
secret, defeating the whole point of a one-time reveal.

**List** — `GET /teams/:teamId/keys` / MCP `list_api_keys` return `id`,
`keyPrefix`, `name`, `createdAt`. Never the hash (even a hash of a live
credential doesn't belong in a response), never the secret, and never
`teamId` — it's an internal FK to `teams.id`, redundant and leaky since the
caller already knows which team they're scoped to.

**Authenticate** — clients send the secret in the `x-sendlit-apikey` header
(or request body). `resolveAuth` (`src/auth/resolve-auth.ts`) hashes it and
looks it up via `getApiKeyBySecret`; a match yields
`{ kind: "apikey", teamId }`. Bearer/OAuth is always checked first and does
not fall back to API keys on an invalid token.

**Revoke** — by id, not by secret: `DELETE /teams/:teamId/keys/:keyId` / MCP
`delete_api_key({ keyId })`. Deletion is immediate; integrations using the
key stop working on their next request.

## Rules of thumb when touching this code

- Never persist or log the plaintext secret outside the documented
  create-time surfaces above.
- Never return `key_hash` in any API/MCP response.
- New response shapes for keys should build on `apiKeySchema` /
  `createdApiKeySchema` in `packages/api-contract/src/schemas/teams.ts`, and
  the REST docs + MCP server must be updated together (see `AGENTS.md`).
