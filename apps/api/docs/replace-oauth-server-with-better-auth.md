**PRD: Replace Custom OAuth2 With Better Auth**

**Objective**
Replace SendLit’s custom OAuth2/auth implementation with Better Auth to support secure first-party web login, MCP OAuth, REST API authentication, and social login with Google plus Email OTP.

**Background**
SendLit currently has a custom OAuth2 implementation in `apps/api/src/oauth/*` and a BFF session/token flow in `apps/web/app/api/auth/*` and `apps/web/app/api/proxy/[...path]/route.ts`.

The current implementation has been improved, but maintaining OAuth correctly remains high-risk. Better Auth provides an integrated auth framework with Express support, social login, Email OTP, API keys, OAuth 2.1 provider support, OIDC-compatible endpoints, JWT/resource-server support, and MCP-oriented OAuth support.

**Goals**

- Replace custom web login with Better Auth session-based login.
- Support Google login.
- Support Email OTP login.
- Support MCP clients through Better Auth OAuth Provider.
- Support REST API authentication via API keys and/or OAuth bearer tokens.
- Preserve SendLit’s account/team authorization model.
- Keep dashboard auth cookie-based and httpOnly.
- Remove custom refresh-token logic, OAuth model, token limiter complexity, and BFF refresh handling.
- Add tests covering login, session resolution, API auth, MCP OAuth metadata, and unauthorized redirects.

**Non-Goals**

- Implement Microsoft/GitHub login in this PRD. Architecture should allow adding them later.
- Replace team membership, team switching, or SendLit authorization rules.
- Replace existing API key behavior unless explicitly chosen during implementation.
- Build a full enterprise SSO/SAML system.
- Introduce Hydra/Ory as a separate auth service.

**Users And Clients**

- Dashboard user: logs in with Google or Email OTP.
- REST API client: authenticates with API key or OAuth bearer token.
- MCP client: discovers OAuth metadata, registers or uses an OAuth client, obtains bearer tokens, and calls `/mcp`.

**Target Architecture**

- `apps/api` owns Better Auth.
- Better Auth mounted before `express.json()` at `/api/auth/*` or `/auth/*`.
- Web dashboard uses Better Auth session cookies.
- `apps/web` no longer stores SendLit access/refresh token cookies.
- BFF proxy no longer refreshes OAuth tokens for dashboard calls.
- API auth middleware resolves identity from:
    - Better Auth session cookie for first-party web requests;
    - OAuth bearer token for MCP/REST delegated clients;
    - API key for server-to-server REST/MCP clients.
- SendLit authorization remains separate:
    - account identity;
    - team membership;
    - active team selection via `X-Sendlit-Team-Id` or team cookie;
    - team-scoped resource access.

**Better Auth Features To Use**

- Core session auth.
- Email OTP plugin.
- Google social provider.
- OAuth Provider plugin for MCP/OAuth clients.
- API Key plugin, or adapter around existing `api_keys` table.
- JWT plugin if using verifiable JWT access tokens for REST/MCP.
- Optional Organization plugin later if it maps cleanly to SendLit teams.

**Authentication Flows**

**1. Web Login With Google**

1. User opens `/login`.
2. User clicks “Continue with Google”.
3. Web calls Better Auth social sign-in.
4. Better Auth redirects to Google.
5. Google redirects to Better Auth callback.
6. Better Auth creates/links user account and session.
7. User lands on `/dashboard`.
8. Dashboard API calls include session cookie.

Acceptance:

- New Google user gets a SendLit account.
- Existing account with same verified Google identity signs in.
- Session cookie is httpOnly, secure in production, same-site safe.
- User is redirected to `/dashboard` after login.
- Unauthorized dashboard access redirects to `/login`.

**2. Web Login With Email OTP**

1. User enters email on `/login`.
2. Better Auth sends OTP email.
3. User enters OTP.
4. Better Auth verifies OTP and creates session.
5. User lands on `/dashboard`.

Acceptance:

- OTP expires within configured TTL.
- OTP attempt limit is enforced.
- OTP resend cooldown is enforced.
- Dev mode may expose OTP only in logs or test helpers, not in production responses.
- Existing email account is reused.
- New email user gets a SendLit account.

**3. Dashboard API Calls**

1. Dashboard calls BFF proxy or API route.
2. Server resolves Better Auth session.
3. Server resolves SendLit account.
4. Server resolves selected team.
5. API performs resource authorization.

Acceptance:

- Expired/missing session returns `401`.
- Web client redirects to `/login`.
- No inline “unauthorized” dashboard banners for expired sessions.
- No refresh-token stampede path remains.

**4. REST API With API Key**

1. Client sends `x-sendlit-apikey`.
2. API validates key.
3. API resolves fixed team.
4. API performs team-scoped action.

Acceptance:

- Current API key behavior remains compatible.
- API keys never authenticate as account-wide users.
- API keys are hashed at rest.
- Revoked/deleted keys stop working.

**5. REST API With OAuth Bearer Token**

1. Client obtains token through Better Auth OAuth Provider.
2. Client sends `Authorization: Bearer <token>`.
3. API validates token using Better Auth resource client/JWT verification/introspection.
4. API maps token subject to SendLit account.
5. API resolves requested team if allowed.
6. API performs scoped action.

Acceptance:

- Invalid/expired tokens return `401`.
- Missing team where required returns existing team-required behavior.
- Token scopes can be mapped to SendLit permissions.

**6. MCP OAuth**

1. MCP client discovers OAuth metadata.
2. Client registers or uses configured OAuth client.
3. Client performs Authorization Code + PKCE.
4. Client obtains access token.
5. Client calls `/mcp`.
6. MCP middleware verifies token and resolves account/team/scopes.

Acceptance:

- Required MCP OAuth discovery endpoints are available.
- Dynamic client registration policy is explicit.
- PKCE is required for public clients.
- MCP requests receive correct auth context.
- Existing MCP tools continue to work.

**Data Model Requirements**
Better Auth will introduce its own tables. Exact schema depends on Better Auth generation/migration output.

Required mapping:

- Better Auth user ID maps to SendLit `accounts.id` or a new auth identity mapping table.
- Email remains unique for SendLit accounts where applicable.
- Google identity links to the same account if policy allows.
- Team membership remains in existing `team_members`.

Recommended additions:

- `auth_account_links` if Better Auth does not already model provider links in a way we can query:
    - `accountId`
    - `provider`
    - `providerAccountId`
    - `createdAt`
- Or use Better Auth’s user/account tables as source of truth and add `sendlitAccountId` mapping.

Decision needed:

- Should Better Auth’s `user.id` become SendLit `accounts.id`, or should we maintain a mapping?
- Recommended: maintain mapping initially to reduce migration risk.

**Endpoint Changes**
Remove or deprecate:

- `apps/api/src/oauth/routes.ts`
- `apps/api/src/oauth/model.ts`
- `apps/api/src/oauth/jwt.ts`
- `apps/api/src/oauth/server.ts`
- `apps/api/src/oauth/revoked-token-store.ts`
- custom `/oauth/*` routes after migration window.
- web `/api/auth/login` and `/api/auth/callback/sendlit` custom routes.
- BFF refresh-token logic in `/api/proxy/[...path]`.

Add:

- Better Auth handler route in API:
    - `/api/auth/*` or `/auth/*`
- OAuth Provider endpoints under Better Auth’s configured base path.
- Login UI actions for:
    - Google
    - Email OTP
- Session-check endpoint if needed:
    - `/api/auth/session`
    - or use Better Auth client helpers.

Keep:

- `/mcp`
- REST API routes
- `/openapi.json`
- `/docs`
- API key routes if retaining existing keys.

**Web App Changes**

- Replace current login button flow with Better Auth client.
- Add Google login button.
- Add Email OTP form:
    - email input step;
    - OTP input step;
    - resend OTP state;
    - error states.
- Replace `requireAuth()` to validate Better Auth session instead of checking token cookies.
- Replace dashboard BFF token forwarding:
    - either proxy session cookie to API;
    - or call same-origin API routes that resolve session server-side.
- Remove access/refresh token cookies:
    - `sendlit_access_token`
    - `sendlit_refresh_token`
- Keep team selection cookie:
    - `sendlit_team_id`, unless moved to session/user preferences.

**API Auth Middleware Changes**
Current auth resolution should be refactored to support:

```ts
type AuthResult =
    | { kind: "session"; accountId: string; account: Account }
    | { kind: "oauth"; accountId: string; clientId: string; scopes: string[] }
    | { kind: "apikey"; apiKey: string; teamId: string }
    | { status: "missing" | "invalid_token" | "unauthorized" };
```

Resolution order:

1. API key if `x-sendlit-apikey` is present.
2. OAuth bearer token if `Authorization: Bearer` is present.
3. Better Auth session if cookies are present.
4. Missing/unauthorized.

Important:

- Invalid bearer token must not fall back to API key.
- API key must remain team-scoped.
- Session/OAuth account auth must still pass through team membership checks.

**Security Requirements**

- Web sessions must use httpOnly cookies.
- Cookies must be `secure` in production.
- Dashboard must not store bearer tokens in localStorage.
- OAuth public clients must use PKCE.
- Dynamic client registration must be intentionally configured:
    - unrestricted only if MCP requires it;
    - otherwise require authenticated/admin registration.
- Access tokens must have clear audience/resource validation.
- OAuth scopes must map to SendLit permissions.
- Login and consent pages must set anti-clickjacking headers:
    - `Content-Security-Policy: frame-ancestors 'none'`
    - preferably `X-Frame-Options: DENY`
- Rate limits must exist for:
    - OTP send;
    - OTP verify;
    - OAuth token endpoint;
    - dynamic registration;
    - API key creation.
- Google account linking must only trust verified identities.
- Microsoft/GitHub can be added later, but provider identity anchor policy must be explicit.
- Audit logs should be emitted for:
    - login success/failure;
    - API key creation/revocation;
    - OAuth client creation/deletion;
    - suspicious token validation failure patterns.

**Migration Plan**
Phase 1: Foundation

- Add Better Auth dependency.
- Add Better Auth config in `apps/api`.
- Add generated/migrated auth tables.
- Mount Better Auth handler before `express.json()`.
- Add Email OTP and Google provider config.
- Add test-only auth helpers.

Phase 2: Account Mapping

- Implement mapping from Better Auth user to SendLit account.
- On first login:
    - create SendLit account;
    - create default team if needed;
    - create team member row.
- On existing login:
    - resolve existing account by mapping or verified email policy.
- Add migration script if needed for existing accounts.

Phase 3: Web Login

- Replace login page with Better Auth login.
- Replace custom callback/login routes.
- Replace `requireAuth()`.
- Remove dashboard dependency on SendLit token cookies.
- Ensure unauthorized dashboard redirects to `/login`.

Phase 4: REST API Auth

- Update `resolveAuth()`.
- Support Better Auth session cookies.
- Support Better Auth OAuth bearer token validation.
- Preserve existing API key behavior.
- Add tests for auth precedence and invalid-token behavior.

Phase 5: MCP OAuth

- Enable Better Auth OAuth Provider plugin.
- Configure OAuth metadata endpoints.
- Configure client registration policy.
- Update MCP auth middleware to validate Better Auth tokens.
- Add MCP discovery and token validation tests.

Phase 6: Remove Custom OAuth

- Remove custom `/oauth/*` routes.
- Remove old JWT refresh-token code.
- Remove BFF refresh logic.
- Remove old token cookies.
- Update docs and OpenAPI/MCP auth docs.
- Add redirect compatibility only if needed.

Phase 7: Rollout

- Deploy behind feature flag:
    - `AUTH_PROVIDER=custom|better-auth`
- Test in QA with fresh accounts and existing accounts.
- Run migration/backfill.
- Switch web login first.
- Switch MCP OAuth next.
- Switch REST bearer validation last.
- Remove old implementation after stability window.

**Backward Compatibility**
Need explicit decision:

- Existing browser sessions will be invalidated during migration, unless we build a bridge.
- Existing API keys should continue working.
- Existing MCP OAuth clients using current `/oauth/register`, `/oauth/token`, `/oauth/authorize` may break if endpoint paths change.

Recommended:

- Keep current `/oauth/*` routes as aliases/proxies to Better Auth endpoints for one release if feasible.
- Otherwise document breaking change for MCP OAuth clients.

**Testing Requirements**
Unit tests:

- Google login callback maps user to account.
- Email OTP login maps user to account.
- Existing verified email resolves existing account.
- Unverified or provider-missing email behavior is explicit.
- `resolveAuth()` handles session, bearer token, API key.
- Invalid bearer token does not fall back.
- API key remains team-scoped.
- Team selection still works.
- Unauthorized dashboard API response redirects to login.

Integration tests:

- Email OTP login full flow.
- Google provider mocked flow.
- Dashboard session access.
- REST API with session.
- REST API with API key.
- REST API with OAuth bearer.
- MCP metadata discovery.
- MCP token validation.
- Dynamic client registration policy.

Regression tests:

- No access/refresh cookie stampede path remains.
- Expired session causes redirect, not inline unauthorized.
- Logout clears Better Auth session.
- Team switch preserves session.

Manual QA:

- Login with Google.
- Login with Email OTP.
- Logout.
- Switch teams.
- Create API key.
- Call REST endpoint with API key.
- MCP client authorization flow.
- Expired session behavior.
- Invalid/expired bearer behavior.

**Open Questions**

- Should Better Auth user ID replace SendLit account ID, or should we keep a mapping? - Better auth tables should be different
- Should REST OAuth bearer tokens be JWT or opaque with introspection? - whatever is the best
- Should public dynamic client registration be allowed for MCP? - Yes, DCR is needed
- Should OAuth clients be owned by account or team? - Account
- Which scopes do we expose initially? - basic ones
- Do MCP clients need offline access/refresh tokens? - You decide
- Do we need consent UI for first-party clients, third-party clients, or both? - You decide
- Do we keep existing API key system or migrate to Better Auth API Key plugin? - Keep it

**Initial Scope Recommendation**
For first implementation:

- Better Auth sessions for web.
- Google login.
- Email OTP login.
- Existing API keys retained.
- Better Auth OAuth Provider for MCP.
- OAuth bearer support for REST, but only with basic scopes:
    - `contacts:read`
    - `contacts:write`
    - `templates:read`
    - `templates:write`
    - `sequences:read`
    - `sequences:write`
    - `settings:read`
    - `settings:write`
- Keep SendLit team model unchanged.
- Do not add GitHub/Microsoft until Google + Email OTP + MCP are stable.

**Success Metrics**

- No custom refresh-token code remains.
- Dashboard login works with Google and Email OTP.
- Existing API key REST integrations continue working.
- MCP OAuth flow works with standards-based clients.
- Unauthorized dashboard state always redirects cleanly.
- Auth test coverage exists across web, REST, and MCP paths.
- No tokens are stored in browser localStorage for dashboard auth.

---

**Addendum: Unified Login Screen**

**Context**

The original Web Login flows (sections 1–2 above) assumed `apps/web`'s `/login` would call Better Auth directly. In practice this produced two separate login UI implementations: a React form in `apps/web` and a server-rendered page in `apps/api` (`apps/api/src/auth/oauth-pages.ts`, `/oauth/login`) used only by MCP/OAuth clients. This addendum consolidates both onto the single `apps/api`-hosted page. It does not change the cookie-based dashboard architecture established above — `apps/web` still never stores access/refresh tokens, still only ever holds a session cookie forwarded by its BFF proxy.

**Decision**

- `apps/api` hosts the only login UI, at a new plain (non-OAuth) `/login` route alongside the existing `/oauth/login`. Both reuse the same markup/JS/styles (`layout()`, `SHARED_STYLES` in `oauth-pages.ts`).
- `apps/web`'s `/login` becomes a redirect-only route with no UI of its own.
- Better Auth's session cookie is scoped to the shared parent domain (`Domain=.sendlit.<domain>` in production, via Better Auth's `advanced.crossSubDomainCookies`), so a session established on `api.sendlit.<domain>` is automatically valid on `app.sendlit.<domain>` too — confirmed both subdomains share one parent domain per `single-server-setup`'s Caddyfile (`app.sendlit.$DOMAIN`, `api.sendlit.$DOMAIN`). In local dev, `api`/`web` already share a cookie jar (same host `localhost`, different ports — cookies aren't port-scoped), so no dev-only special-casing is needed.

**Updated Flow — Dashboard Login**

1. User visits `app.sendlit.<domain>/dashboard` with no valid session.
2. `requireAuth()` → `hasServerSession()` finds no session, redirects to `app.sendlit.<domain>/login`.
3. `apps/web`'s `/login` 302s to `api.sendlit.<domain>/login?redirect=https://app.sendlit.<domain>/dashboard`.
4. User completes email/OTP or Google sign-in on `apps/api`'s hosted page (the same page MCP users see at `/oauth/login`, minus the OAuth-resume logic):
    - Email/OTP: page calls same-origin `/api/auth/email-otp/send-verification-otp`, then `/api/auth/sign-in/email-otp`; on success, the session cookie is set (now cross-subdomain) and the page does `location.assign(redirect)`.
    - Google: page calls `/api/auth/sign-in/social` with `callbackURL=redirect`; Better Auth handles the Google round trip and redirects straight to `callbackURL` on success.
5. Browser lands back on `app.sendlit.<domain>/dashboard` carrying the shared session cookie.
6. `requireAuth()` succeeds; dashboard renders. All subsequent `/api/proxy/*` calls are unchanged — the proxy still just forwards whatever `Cookie` header the browser attached.
7. Logout still clears the session on the shared domain, signing the user out of both subdomains at once.

**Updated Flow — MCP Client Login (unchanged in substance)**

Same page as above, but reached via `/oauth2/authorize` → `/oauth/login?oauth_query=<signed>` (existing flow, section 6), resuming the OAuth authorization instead of doing a plain redirect. Both flows converge on identical login UI; the only branch is whether an `oauth_query` (resume OAuth) or a plain `redirect` (bounce back to the dashboard) is present.

**Added benefit:** since both subdomains now share one session, a user already logged in via one flow (e.g. having just authorized an MCP client) skips the login screen entirely on the other (step 2 above succeeds immediately) — effective SSO between the dashboard and MCP, with no additional implementation.

**New Requirement: Open-Redirect Protection**

`apps/api`'s plain `/login?redirect=...` must validate `redirect` against an allowlist (the configured `WEB_CLIENT` origin only) before honoring it — otherwise it's an open redirect off the API's own domain.

**Updated Web App Changes**

Supersedes the original Web App Changes bullets on the Email OTP form / Google login button:

- `apps/web` no longer implements its own Email OTP form or Google login button; `apps/web/app/login/login-form.tsx` is removed.
- `apps/web`'s `/login` route is now a thin redirect to `apps/api`'s hosted `/login`.
- `apps/web/app/api/auth/[...path]/route.ts` (the generic Better Auth proxy) is reduced or removed to whatever's still needed for session-check/sign-out — OTP/Google calls no longer route through it, since the browser now talks to `apps/api` directly during login.

**Updated Security Requirements**

Adds to the original Security Requirements list:

- Session cookie uses `Domain=.sendlit.<domain>` in production (cross-subdomain), scoped only to first-party SendLit subdomains — never a public suffix.
- The plain login page's `redirect` parameter must be allowlist-validated against `WEB_CLIENT` to prevent open redirects.
