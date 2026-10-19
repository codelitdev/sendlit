## Headless provisioning

The goal is a repeatable, headless integration path: SendLit can be initialized without extracting a generated key from logs or using a human dashboard session, and CourseLit can keep provisioning teams without holding delivery-administration privileges.

### 1. Add the missing organization API capabilities

- Add `GET /provisioning/organization`, authorized by `organization:read`. It returns the calling API key’s own organization metadata and public ID, never another organization’s.
- Keep `GET` and `PUT /organizations/:organizationId/delivery-policy`. Permit an organization API key only when it is bound to the URL’s organization and has:
    - `delivery:read` for `GET`
    - `delivery:manage` for `PUT`
- Preserve owner/admin user-session access. Don’t treat nearby scopes such as ESP or grant management as implicit delivery-policy authority.
- Preserve validation that a default ESP belongs to the organization and is active. Audit key-based policy changes as organization-key actions.
- The ESP test-send route already accepts an explicit recipient. Keep that behavior and test/document it for organization-key calls.

One permission detail needs to be explicit in the implementation and docs: `delivery:manage` authorizes the policy update schema, which includes more than just the default ESP and automatic grants—it may include quota and team-delivery controls. The one-shot setup key limits the duration of that authority. If automation must be permanently restricted to just the default-delivery fields, that should be a separately scoped capability, not an undocumented restriction on `delivery:manage`.

### 2. Register separate setup and runtime keys

Bootstrap should find or create the initial owner’s organization using `BOOTSTRAP_ORGANIZATION_OWNER_EMAIL`, then register the configured keys there—even when the user already exists. It should not create a second organization or silently restore a revoked key.

| Secret setting                        | Registered key name                  | Use                                   | Scopes                                                                                                                                     | Where it should be available                         |
| ------------------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `BOOTSTRAP_DELIVERY_SETUP_API_KEY`    | `[Auto-generated] Delivery Setup`    | Configure shared delivery once        | `organization:read`, `esps:manage`, `delivery:read`, `delivery:manage`; include `esps:read` if the initializer must list ESPs to reuse one | SendLit bootstrap and one-shot setup client          |
| `BOOTSTRAP_TEAM_PROVISIONING_API_KEY` | `[Auto-generated] Team Provisioning` | CourseLit’s ongoing team provisioning | `organization:read`, `teams:provision`, `teams:read`                                                                                       | SendLit’s one-shot bootstrap and CourseLit’s runtime |

Set both keys directly in the deployment `.env`. Bootstrap hashes them into organization API-key records; it never stores or logs the plaintext. It verifies an existing key’s organization, scopes, and revocation state on reruns. A mismatched or revoked key fails closed. Rotation means registering a new key, switching the integration, then explicitly revoking the old one.

This runtime key is a security improvement, not a prerequisite for team creation. CourseLit currently uses the console-logged bootstrap key, which has broader scopes—including team management, team-key, ESP, and grant-management scopes. It should switch to the narrower configured provisioning key. The old key should remain usable during the switch, then be revoked after the new credential is verified; bootstrap should not revoke it automatically.

Both keys may live in the deployment `.env`, but Compose should pass them only to the one-shot `init` service and explicitly clear them in the API and web containers. Give the delivery key only to setup automation, and give the provisioning key to the integration runtime. Neither belongs in browser code.

### 3. Make initial delivery setup one-time and safe to rerun

The setup workflow should use the delivery key to:

1. Discover the organization.
2. Reuse the intended ESP or create it.
3. Send a test email with an explicit recipient.
4. Activate the ESP.
5. Set it as the default and enable automatic grants.

The workflow should not reset an operator’s later delivery choices every time the stack starts. Run it as an explicit setup job or persist a completion marker. ESP names are not unique, so reuse should be based on a stored ESP ID or fail clearly if the name is ambiguous.

After successful setup, revoke the delivery key if no further delivery-policy automation is needed. CourseLit then uses only the provisioning key to create teams. An end-to-end test should provision a team through the public API and verify that it receives the organization’s delivery grant/default.

### 4. Update integration documentation as a core deliverable

Create a canonical integration guide in `apps/docs`, with a raw Markdown version that is easy for both people and agents to consume. Link it from the root self-hosting README and `apps/api/README.md`. Update the existing organization and API-key docs, and the API contract/OpenAPI descriptions.

The guide should provide:

- The exact setup sequence above, with copyable REST examples based on the API contract.
- The required scopes for each key, how to send organization keys as Bearer credentials, and how to discover the organization ID.
- Example request/response shapes for ESP creation, explicit-recipient test sends, activation, delivery-policy updates, and team provisioning.
- A clear explanation that `BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` selects the initial owner; it does not grant a special global-admin role.
- `.env` configuration, reruns, rotation, revocation, and migration from the old log-generated bootstrap key.
- A link to the machine-readable OpenAPI spec and guidance for agent or SDK integrations.
- A warning that `delivery:manage` can authorize changes beyond selecting a default ESP.

Update `.env.example` and Compose documentation to show environment-variable names and placeholders, not real secret values. Keep the separate Compose/Mailpit follow-up responsible for the local transport setup (`mailpit:1025`), health checks, and configurable test recipient; these are not special behaviors in SendLit’s general API.

### 5. Tests and implementation boundaries

Tests should cover organization-key discovery isolation, scope failures and successes, organization binding, existing owner/admin sessions, policy validation and audit attribution, explicit-recipient ESP tests, bootstrap for both new and existing users, hashed-only/idempotent key registration, and team delivery inheritance. Update scope validation, API contract, OpenAPI documentation, and audit behavior alongside the routes.

The repository currently has the earlier `SUPER_ADMIN_EMAIL` → `BOOTSTRAP_ORGANIZATION_OWNER_EMAIL` rename and billing-alert recipient separation. The API capabilities, configured-key bootstrap, and integration guide described here are additional work.
