import { createPlatformError, type PlatformError } from "@codelitdev/platform";
import { canManageTeamEsp, isTeamAdminOrKey } from "../team/authority";
import type { SendLitMcpContext } from "./context";

export const MCP_SCOPES = {
  contactsRead: "contacts:read",
  contactsWrite: "contacts:write",
  templatesRead: "templates:read",
  templatesWrite: "templates:write",
  mediaRead: "media:read",
  mediaWrite: "media:write",
  sequencesRead: "sequences:read",
  sequencesWrite: "sequences:write",
  emailsRead: "emails:read",
  emailsSend: "emails:send",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  espRead: "esp:read",
  espWrite: "esp:write",
  teamsRead: "teams:read",
  teamsWrite: "teams:write",
  apiKeysRead: "api_keys:read",
  apiKeysWrite: "api_keys:write",
  feedbackRead: "feedback:read",
  feedbackWrite: "feedback:write",
  deliveryEventsRead: "delivery_events:read",
  suppressionsRead: "suppressions:read",
  suppressionsWrite: "suppressions:write",
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

export const MCP_SCOPES_SUPPORTED = Object.freeze(
  Object.values(MCP_SCOPES),
) as readonly McpScope[];

/**
 * The OAuth scope each MCP-reachable REST operation needs, keyed by its
 * contract operation id (see the parity manifest in `@sendlit/api-contract`).
 * Dedicated tools and the generic `api.*` tools both authorize through this
 * table, so an operation needs the same scope however it is reached. An
 * operation missing here is refused (default deny).
 */
const operationScopes = {
  "contacts.create": MCP_SCOPES.contactsWrite,
  "contacts.list": MCP_SCOPES.contactsRead,
  "contacts.get": MCP_SCOPES.contactsRead,
  "contacts.update": MCP_SCOPES.contactsWrite,
  "contacts.addTag": MCP_SCOPES.contactsWrite,
  "contacts.removeTag": MCP_SCOPES.contactsWrite,
  "contacts.deliveries": MCP_SCOPES.contactsRead,
  "contacts.events": MCP_SCOPES.contactsRead,
  "contacts.remove": MCP_SCOPES.contactsWrite,
  "contacts.previewBulkDelete": MCP_SCOPES.contactsRead,
  "contacts.bulkDelete": MCP_SCOPES.contactsWrite,
  "contacts.bulkDeleteStatus": MCP_SCOPES.contactsRead,
  "tags.list": MCP_SCOPES.contactsRead,
  "tags.references": MCP_SCOPES.contactsRead,
  "tags.rename": MCP_SCOPES.contactsWrite,
  "tags.remove": MCP_SCOPES.contactsWrite,
  "segments.create": MCP_SCOPES.contactsWrite,
  "segments.list": MCP_SCOPES.contactsRead,
  "segments.get": MCP_SCOPES.contactsRead,
  "segments.update": MCP_SCOPES.contactsWrite,
  "segments.remove": MCP_SCOPES.contactsWrite,
  "media.list": MCP_SCOPES.mediaRead,
  "media.get": MCP_SCOPES.mediaRead,
  "media.update": MCP_SCOPES.mediaWrite,
  "media.remove": MCP_SCOPES.mediaWrite,
  "media.references": MCP_SCOPES.mediaRead,
  "templates.listSystem": MCP_SCOPES.templatesRead,
  "templates.create": MCP_SCOPES.templatesWrite,
  "templates.list": MCP_SCOPES.templatesRead,
  "templates.get": MCP_SCOPES.templatesRead,
  "templates.update": MCP_SCOPES.templatesWrite,
  "templates.duplicate": MCP_SCOPES.templatesWrite,
  "templates.remove": MCP_SCOPES.templatesWrite,
  "sequences.create": MCP_SCOPES.sequencesWrite,
  "sequences.list": MCP_SCOPES.sequencesRead,
  "sequences.get": MCP_SCOPES.sequencesRead,
  "sequences.update": MCP_SCOPES.sequencesWrite,
  "sequences.remove": MCP_SCOPES.sequencesWrite,
  "sequences.deletionPreview": MCP_SCOPES.sequencesRead,
  "sequences.archive": MCP_SCOPES.sequencesWrite,
  "sequences.unarchive": MCP_SCOPES.sequencesWrite,
  "sequences.addEmail": MCP_SCOPES.sequencesWrite,
  "sequences.updateEmail": MCP_SCOPES.sequencesWrite,
  "sequences.publishChanges": MCP_SCOPES.sequencesWrite,
  "sequences.discardChanges": MCP_SCOPES.sequencesWrite,
  "sequences.emailVersions": MCP_SCOPES.sequencesRead,
  "sequences.restoreEmailVersion": MCP_SCOPES.sequencesWrite,
  "contacts.import": MCP_SCOPES.contactsWrite,
  "suppressions.create": MCP_SCOPES.suppressionsWrite,
  "forms.list": MCP_SCOPES.contactsRead,
  "forms.create": MCP_SCOPES.contactsWrite,
  "forms.get": MCP_SCOPES.contactsRead,
  "forms.update": MCP_SCOPES.contactsWrite,
  "forms.remove": MCP_SCOPES.contactsWrite,
  "contacts.export": MCP_SCOPES.contactsRead,
  "sequences.sendEmailTest": MCP_SCOPES.sequencesWrite,
  "sequences.removeEmail": MCP_SCOPES.sequencesWrite,
  "sequences.start": MCP_SCOPES.sequencesWrite,
  "sequences.pause": MCP_SCOPES.sequencesWrite,
  "sequences.stats": MCP_SCOPES.sequencesRead,
  "sequences.schedule": MCP_SCOPES.sequencesRead,
  "sequences.waitingContacts": MCP_SCOPES.sequencesRead,
  "sequences.getWeb": MCP_SCOPES.sequencesRead,
  "sequences.updateWeb": MCP_SCOPES.sequencesWrite,
  "web.list": MCP_SCOPES.sequencesRead,
  "web.get": MCP_SCOPES.sequencesRead,
  "reputation.get": MCP_SCOPES.settingsRead,
  "reputation.connectGoogle": MCP_SCOPES.settingsWrite,
  "reputation.disconnectGoogle": MCP_SCOPES.settingsWrite,
  "reputation.connectSnds": MCP_SCOPES.settingsWrite,
  "reputation.disconnectSnds": MCP_SCOPES.settingsWrite,
  "reputation.sync": MCP_SCOPES.settingsWrite,
  "sequences.subscribers": MCP_SCOPES.sequencesRead,
  "transactional.send": MCP_SCOPES.emailsSend,
  "transactional.get": MCP_SCOPES.emailsRead,
  "transactional.list": MCP_SCOPES.emailsRead,
  "events.track": MCP_SCOPES.contactsWrite,
  "events.definitions": MCP_SCOPES.contactsRead,
  "events.definition": MCP_SCOPES.contactsRead,
  "events.createDefinition": MCP_SCOPES.contactsWrite,
  "events.updateDefinition": MCP_SCOPES.contactsWrite,
  "events.deleteDefinition": MCP_SCOPES.contactsWrite,
  "settings.esps.list": MCP_SCOPES.espRead,
  "settings.esps.create": MCP_SCOPES.espWrite,
  "settings.esps.get": MCP_SCOPES.espRead,
  "settings.esps.update": MCP_SCOPES.espWrite,
  "settings.esps.remove": MCP_SCOPES.espWrite,
  "settings.esps.test": MCP_SCOPES.espWrite,
  "settings.esps.domainAuthentication": MCP_SCOPES.espRead,
  "settings.esps.activate": MCP_SCOPES.espWrite,
  "settings.esps.retire": MCP_SCOPES.espWrite,
  "settings.general.get": MCP_SCOPES.settingsRead,
  "settings.general.update": MCP_SCOPES.settingsWrite,
  "settings.trackingDomain.get": MCP_SCOPES.settingsRead,
  "settings.trackingDomain.update": MCP_SCOPES.settingsWrite,
  "settings.trackingDomain.verify": MCP_SCOPES.settingsWrite,
  "settings.web.get": MCP_SCOPES.settingsRead,
  "settings.web.update": MCP_SCOPES.settingsWrite,
  "teams.list": MCP_SCOPES.teamsRead,
  "teams.create": MCP_SCOPES.teamsWrite,
  "teams.rename": MCP_SCOPES.teamsWrite,
  "teams.remove": MCP_SCOPES.teamsWrite,
  "teams.listKeys": MCP_SCOPES.apiKeysRead,
  "teams.createKey": MCP_SCOPES.apiKeysWrite,
  "teams.removeKey": MCP_SCOPES.apiKeysWrite,
  "feedback.get": MCP_SCOPES.feedbackRead,
  "feedback.upsert": MCP_SCOPES.feedbackWrite,
  "feedback.test": MCP_SCOPES.feedbackWrite,
  "feedback.remove": MCP_SCOPES.feedbackWrite,
  "deliveryEvents.list": MCP_SCOPES.deliveryEventsRead,
  "deliveryEvents.get": MCP_SCOPES.deliveryEventsRead,
  "suppressions.list": MCP_SCOPES.suppressionsRead,
  "suppressions.get": MCP_SCOPES.suppressionsRead,
  "suppressions.release": MCP_SCOPES.suppressionsWrite,
  "billing.organizationPlanUsage": MCP_SCOPES.teamsRead,
} as const satisfies Record<string, McpScope>;

export type McpOperationId = keyof typeof operationScopes;

/**
 * Operations a team API key may never run, mirroring REST, which refuses key
 * management to key callers. Otherwise a leaked key could mint replacement
 * keys for itself, so revoking it would not cut off the attacker, or revoke
 * the team's other keys.
 */
const teamKeyDeniedOperations: ReadonlySet<string> = new Set<McpOperationId>([
  "teams.listKeys",
  "teams.createKey",
  "teams.removeKey",
]);

/**
 * Operations REST reserves to team admins (or a team key), whatever scope the
 * caller holds. A scope only says what a token may do for its user; it says
 * nothing about the user's role in the team. Without this a plain member could
 * consent to `esp:write` for their own client and repoint the team's ESP at a
 * host they control.
 */
const teamAdminOperations: ReadonlySet<string> = new Set<McpOperationId>([
  "reputation.connectGoogle",
  "reputation.disconnectGoogle",
  "reputation.connectSnds",
  "reputation.disconnectSnds",
  "settings.esps.create",
  "settings.esps.update",
  "settings.esps.remove",
  "settings.esps.test",
  "settings.esps.activate",
  "settings.esps.retire",
]);

/** Of those, the ones that also need the organization to allow team ESPs. */
const teamEspOperations: ReadonlySet<string> = new Set<McpOperationId>([
  "settings.esps.create",
  "settings.esps.update",
  "settings.esps.remove",
  "settings.esps.test",
  "settings.esps.activate",
  "settings.esps.retire",
]);

/** The role check REST applies, for the operations that have one. Run after
 * `authorizeMcpOperation`; null when the caller may proceed. */
export async function authorizeTeamAuthority(
  operationId: string,
  context: SendLitMcpContext,
): Promise<PlatformError | null> {
  if (!teamAdminOperations.has(operationId)) return null;
  const caller = {
    authKind: context.authKind,
    teamId: context.teamId,
    userId: context.user?.id ?? null,
  };
  const allowed = teamEspOperations.has(operationId)
    ? await canManageTeamEsp(caller)
    : await isTeamAdminOrKey(caller);
  if (allowed) return null;
  return createPlatformError("forbidden", {
    safeDetails: {
      reason: teamEspOperations.has(operationId)
        ? "team_esp_disabled"
        : "team_admin_required",
    },
  });
}

export function isMcpOperation(operationId: string): operationId is McpOperationId {
  return Object.hasOwn(operationScopes, operationId);
}

export function getRequiredScope(operationId: string): McpScope {
  if (!isMcpOperation(operationId)) {
    throw new Error(`MCP operation '${operationId}' has no authorization policy.`);
  }
  return operationScopes[operationId];
}

/** Why the caller may not run the operation, or null when it may. */
export function authorizeMcpOperation(
  operationId: string,
  context: SendLitMcpContext,
): PlatformError | null {
  if (!isMcpOperation(operationId)) {
    return createPlatformError("forbidden", {
      safeDetails: { reason: "not_mcp_operation" },
    });
  }
  // A team API key is already a full-access credential for exactly one team,
  // except for managing API keys, which requires a user (OAuth) session.
  if (context.authKind === "team_key") {
    return teamKeyDeniedOperations.has(operationId)
      ? createPlatformError("forbidden", {
          safeDetails: { reason: "user_auth_required" },
        })
      : null;
  }
  const requiredScope = operationScopes[operationId];
  return context.scopes.includes(requiredScope)
    ? null
    : createPlatformError("forbidden", {
        safeDetails: { reason: "insufficient_scope", requiredScope },
      });
}

export function listMcpOperationScopes(): Readonly<Record<McpOperationId, McpScope>> {
  return operationScopes;
}
