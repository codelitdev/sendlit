# Plan: Org mail metrics + audited Enter team

## Goal

Give organization owners/admins visibility and optional access for **org-API-key–provisioned teams**, without making every provisioned tenant automatically readable.

Locked product choices:

1. **Enter team** = permanent `team_members` grant (role `admin`), audited
2. **Org metrics** = per-team + org totals for **transactional** mail (`sent` / `queued` / `failed` / `bounced`) over a selectable window (1/3/7/30 days)

## Non-goals (v1)

- Time-limited break-glass sessions / auto-expiry
- Campaign/broadcast/sequence counts or full send activity feeds
- Auto-adding org admins during `POST /provisioning/teams`
- Letting organization API keys enter teams as humans
- Exposing email content, recipients, or subjects at org scope

## Current baseline

- Provisioning creates teams with **no** `team_members` rows (`apps/api/src/team/queries.ts`, `apps/api/docs/platform-customer.md`)
- Human-managed `POST /organizations/:id/teams` already inserts the creator as team `admin`
- There is **no** add-member / invite API today (`ARCHITECTURE.md` roadmap item)
- Org **Shared-delivery usage** only counts organization-mailbox quota (`getOrganizationQuotaUsage`) and explicitly excludes team-owned ESP sends
- Team switcher loads only `listTeams()` → membership-scoped teams; `notifyTeamsChanged()` already refreshes the sidebar after human team create

---

## Feature A — Org aggregate transactional metrics

### API

Add:

`GET /organizations/:organizationId/mail-activity?rangeDays=7`

Auth (same bar as usage):

- human org `owner` / `admin`, **or**
- org key with `usage:read`

Contract (`packages/api-contract`):

```ts
organizationMailActivityQuerySchema = { rangeDays?: 1|3|7|30 }
organizationMailCountsSchema = { sent, queued, failed, bounced }
organizationMailActivitySchema = {
  rangeDays,
  totals: organizationMailCountsSchema,
  teams: Array<{
    teamId,           // public id
    name,
    status,           // active|sending_suspended|archived
    externalId,       // null for human-managed
    mail: organizationMailCountsSchema
  }>
}
```

Include teams with **zero** activity in the window so provisioned quiet tenants still appear (ordered by name). Soft-omit or de-emphasize `archived` in UI if noisy; still return them from API for completeness.

### Query

In `apps/api/src/organization/` (new helper, e.g. `mail-activity.ts`):

1. Load all teams for `organizationId`
2. Left-join / group `transactional_emails` by `team_id` + `status` where `created_at > now - rangeDays`
3. Map statuses into `{ sent, queued, failed, bounced }` (same shape as overview)
4. Sum into `totals`

Reuse the overview counting pattern from `apps/api/src/overview/routes.ts` (status groupBy), but scoped by organization via `teams.organizationId`.

Do **not** fold this into `/usage` — that endpoint remains shared-delivery quota only.

### Web UI

On `apps/web/app/(dashboard)/organizations/page.tsx`, beside/under **Shared-delivery usage**:

- New card: **Transactional mail activity**
- Range selector (1/3/7/30), default 7
- Org totals row
- Compact per-team table: name, provisioned badge/`externalId`, sent/queued/failed/bounced
- Copy clarifying: counts are transactional only; shared-delivery quota remains separate; no email content shown

Wire `getOrganizationMailActivity()` in `apps/web/lib/api.ts`.

### Tests

- API: org with 2 teams, seed transactional rows across statuses → totals + per-team correct; unauthorized member role → 403; wrong org → 404
- Web: page test loads metrics section (extend existing organizations page test mocks)

### Docs

- `apps/docs/content/docs/workspace/organizations.mdx`: document the metrics card and what it does/doesn’t include
- OpenAPI via contract regeneration path already used by the project

---

## Feature B — Audited opt-in “Enter team”

### API

Add:

`POST /organizations/:organizationId/teams/:teamId/enter`

Body: empty / `{}`

Auth:

- **Human only** (`isHuman(req)`), org role `owner` or `admin`
- Reject organization API keys even with `teams:manage` (entering is a personal membership action)

Behavior:

1. Resolve org + team; team must belong to org
2. Refuse if team `archived` (or `sending_suspended`? allow enter so admin can inspect — **allow** suspended, **block** archived)
3. If membership exists → idempotent `200` with `{ teamId, role, created: false }`
4. Else insert `team_members` (`role: "admin"`) → `200` `{ teamId, role, created: true }`
5. Record org audit: `team.entered` with metadata `{ role: "admin", created: true|false }`

Extract a small `ensureTeamMembership({ teamId, userId, role })` in `apps/api/src/team/queries.ts` (unique index already on `(team_id, user_id)`).

Optional companion (nice for UI, low cost):

- Extend org team list payload with `viewerIsMember: boolean` for the calling human (false for org-key callers)
- Or compute client-side by intersecting `listTeams()` with org teams — prefer server flag to avoid race/stale cookies

### Web UI

In Organizations → team row actions menu (`TeamRow` ~line 1695):

- **Enter team** when `!archived && !viewerIsMember`
- **Open team** (or disabled “Already a member”) when already a member
- Confirm dialog copy:

    > You will become a team admin and can see this team’s contacts, campaigns, and mail history. This is recorded in organization audit activity.

On success:

1. `notifyTeamsChanged()`
2. Select that team (existing team cookie / switcher helpers)
3. Navigate to `/` or `/transactional`
4. Toast: “You joined {team name}”

### Security constraints

- No automatic membership at provision time
- Org `member` role cannot enter
- Org API keys cannot enter
- Audit every successful call (including idempotent already-member? **yes**, with `created: false`, so support access attempts are visible — or only audit `created: true`; prefer audit always for break-glass visibility)
- Entering does not reveal ESP secrets beyond normal team member visibility

### Tests

- Enter provisioned team as org admin → membership row + appears in `listTeamsForUser`
- Idempotent second enter
- Org member role → 403
- Org key → 403
- Team in another org → 404
- Archived team → 422/409
- Audit event `team.entered` present
- Web: action calls API and notifies teams changed

### Docs

- Update `organizations.mdx` and `teams.mdx`: how to enter a provisioned team; remind that isolation remains default
- Short note in `apps/api/docs/platform-customer.md` that v1 now allows **explicit audited** human entry by org owners/admins (still no implicit membership)

---

## Implementation order

1. **Contract schemas + routes stubs** in `packages/api-contract`
2. **API: mail-activity query + route + tests**
3. **API: enter-team membership helper + route + tests**
4. **Web API client helpers**
5. **Organizations UI: metrics card + Enter team action/dialog**
6. **Docs**
7. Manual QA on cluster after deploy: provisioned team metrics visible; Enter team puts team in switcher

## File touch list (expected)

| Area     | Files                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract | `packages/api-contract/src/schemas/organizations.ts`, `packages/api-contract/src/contract.ts`                                                                                      |
| API      | `apps/api/src/organization/routes.ts`, new `mail-activity.ts`, `apps/api/src/organization/audit` usage, `apps/api/src/team/queries.ts`, tests under `organization/` and/or `team/` |
| Web      | `apps/web/lib/api.ts`, `apps/web/app/(dashboard)/organizations/page.tsx`, `page.test.tsx`                                                                                          |
| Docs     | `apps/docs/content/docs/workspace/organizations.mdx`, `teams.mdx`, optionally `platform-customer.md`                                                                               |

No DB migration required: reuse `team_members` and `transactional_emails`.

## Risks / tradeoffs

- **Permanent admin grant is powerful** — mitigate with confirm dialog + audit; document as support access
- **Metrics omit campaigns** — call out in UI so “0 transactional” isn’t mistaken for “no mail at all” while broadcasts are stuck/sending
- **Large orgs** — per-team list could grow; v1 acceptable; add pagination later if needed

## Success criteria

1. Org admin sees transactional totals + per-team counts for provisioned teams without joining them
2. Org admin can opt into a provisioned team via **Enter team**, then see it in the switcher and use normal team surfaces
3. Provisioning still creates teams with zero members by default
4. Every Enter-team action is visible under organization audit activity
