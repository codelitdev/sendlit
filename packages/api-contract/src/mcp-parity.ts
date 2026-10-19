/**
 * MCP parity manifest required by CodeLit Platform (architecture section 9).
 *
 * Maps every REST operation in `contract` (dotted router-key IDs such as
 * `contacts.list`) and every SendLit MCP tool to a product capability. Entries
 * are either `required` (REST and MCP expose the same capability at the same
 * risk) or `exempt` (deliberately REST-only or MCP-only, with a reason, owner
 * and review date). `apps/api/src/mcp/parity.test.ts` validates it with
 * `validateParityManifest` from `@codelitdev/mcp-server-kit`.
 *
 * The types below are structural copies of the kit's entry schema so this
 * package does not depend on the kit.
 */

export type McpParityRisk = "read" | "write" | "destructive";

export type McpParityExemption = {
  reason: string;
  owner: string;
  reviewBy: string;
};

export type McpParityManifestEntry =
  | {
      capability: string;
      risk: McpParityRisk;
      rest: { operationId: string };
      mcp: { tool: string };
      parity: "required";
    }
  | {
      capability: string;
      rest?: { operationId: string };
      mcp?: { tool: string };
      parity: "exempt";
      exemption: McpParityExemption;
    };

const OWNER = "sendlit";
const REVIEW_BY = "2027-04-30";

function required(
  operationId: string,
  tool: string,
  risk: McpParityRisk,
): McpParityManifestEntry {
  return {
    capability: operationId,
    risk,
    rest: { operationId },
    mcp: { tool },
    parity: "required",
  };
}

function restOnly(operationId: string, reason: string): McpParityManifestEntry {
  return {
    capability: operationId,
    rest: { operationId },
    parity: "exempt",
    exemption: { reason, owner: OWNER, reviewBy: REVIEW_BY },
  };
}

function mcpOnly(tool: string, reason: string): McpParityManifestEntry {
  return {
    capability: `mcp.${tool}`,
    mcp: { tool },
    parity: "exempt",
    exemption: { reason, owner: OWNER, reviewBy: REVIEW_BY },
  };
}

const BILLING_SESSION_ONLY =
  "Billing is dashboard-session only: plan changes, checkout, portal, cancellation and action tokens require a human session with recent authentication, so there are no MCP tools.";
const ORGANIZATION_ADMIN =
  "Organization administration (members, teams, shared ESPs, feedback, delivery policy, sending domains, usage and audit) is organization-scoped; MCP is team-scoped and accepts neither organization sessions nor organization API keys.";
const ORGANIZATION_KEYS =
  "Organization API key management is REST-only; MCP is team-scoped and never handles organization credentials.";
const PROVISIONING =
  "Team provisioning authenticates with organization API keys; MCP is team-scoped and does not accept organization keys.";
const ESP_LIFECYCLE =
  "ESP suspend, resume and retire are operational lifecycle controls kept REST/dashboard-only; MCP exposes create, activate, test and delete.";
const DELIVERY_SELECTION =
  "Team delivery-source selection (shared organization delivery vs user ESPs) is REST/dashboard-only; MCP manages user ESP configurations directly.";
const DEFAULT_ESP_ALIAS =
  "MCP-only convenience alias over the team's default user ESP; REST exposes the same capability through the per-ESP settings.esps.* operations.";

export const mcpParityManifest: readonly McpParityManifestEntry[] = [
  // Contacts
  required("contacts.create", "create_contact", "write"),
  required("contacts.list", "list_contacts", "read"),
  required("contacts.get", "get_contact", "read"),
  required("contacts.update", "update_contact", "write"),
  required("contacts.addTag", "add_contact_tag", "write"),
  required("contacts.removeTag", "remove_contact_tag", "write"),
  required("contacts.deliveries", "get_contact_deliveries", "read"),
  required("contacts.remove", "delete_contact", "destructive"),

  // Segments
  required("segments.create", "create_segment", "write"),
  required("segments.list", "list_segments", "read"),
  required("segments.get", "get_segment", "read"),
  required("segments.update", "update_segment", "write"),
  required("segments.remove", "delete_segment", "destructive"),

  // Media
  required("media.list", "list_media", "read"),
  restOnly(
    "media.presigned",
    "REST-only upload helper: issues a MediaLit browser upload signature for the dashboard's direct file upload, which has no MCP transport.",
  ),
  required("media.get", "get_media", "read"),
  required("media.update", "update_media", "write"),
  required("media.remove", "delete_media", "destructive"),
  required("media.references", "list_media_references", "read"),

  // Templates
  required("templates.listSystem", "list_system_templates", "read"),
  required("templates.create", "create_template", "write"),
  required("templates.list", "list_templates", "read"),
  required("templates.get", "get_template", "read"),
  required("templates.update", "update_template", "write"),
  required("templates.duplicate", "duplicate_template", "write"),
  required("templates.remove", "delete_template", "destructive"),

  // Broadcasts and sequences
  required("sequences.create", "create_sequence", "write"),
  required("sequences.list", "list_sequences", "read"),
  required("sequences.get", "get_sequence", "read"),
  required("sequences.update", "update_sequence", "write"),
  restOnly(
    "sequences.remove",
    "Deleting a whole broadcast or sequence (and its delivery history) is REST/dashboard-only; MCP can remove individual sequence emails and pause sequences.",
  ),
  required("sequences.addEmail", "add_sequence_email", "write"),
  required("sequences.updateEmail", "update_sequence_email", "write"),
  required("sequences.removeEmail", "delete_sequence_email", "destructive"),
  required("sequences.start", "start_sequence", "write"),
  required("sequences.pause", "pause_sequence", "write"),
  required("sequences.stats", "get_sequence_stats", "read"),
  required("sequences.subscribers", "get_sequence_subscribers", "read"),

  // Transactional email
  required("transactional.send", "send_email", "write"),
  required("transactional.get", "get_email", "read"),
  required("transactional.list", "list_emails", "read"),

  // User-managed ESPs
  required("settings.esps.list", "list_esps", "read"),
  required("settings.esps.create", "create_esp", "write"),
  required("settings.esps.get", "get_esp", "read"),
  required("settings.esps.update", "update_esp", "write"),
  required("settings.esps.remove", "delete_esp", "destructive"),
  required("settings.esps.test", "test_esp", "write"),
  required("settings.esps.activate", "activate_esp", "write"),
  restOnly("settings.esps.suspend", ESP_LIFECYCLE),
  restOnly("settings.esps.resume", ESP_LIFECYCLE),
  restOnly("settings.esps.retire", ESP_LIFECYCLE),
  mcpOnly("get_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("update_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("delete_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("send_test_email", DEFAULT_ESP_ALIAS),

  // General settings
  required("settings.general.get", "get_general_settings", "read"),
  required("settings.general.update", "update_general_settings", "write"),

  // Teams and team API keys
  required("teams.list", "list_teams", "read"),
  required("teams.create", "create_team", "write"),
  required("teams.rename", "rename_team", "write"),
  required("teams.remove", "delete_team", "destructive"),
  required("teams.listKeys", "list_api_keys", "read"),
  required("teams.createKey", "create_api_key", "write"),
  required("teams.removeKey", "delete_api_key", "destructive"),

  // Organization administration
  restOnly("organizations.list", ORGANIZATION_ADMIN),
  restOnly("organizations.create", ORGANIZATION_ADMIN),
  restOnly("organizations.get", ORGANIZATION_ADMIN),
  restOnly("organizations.update", ORGANIZATION_ADMIN),
  restOnly("organizations.close", ORGANIZATION_ADMIN),
  restOnly("organizations.abandon", ORGANIZATION_ADMIN),
  restOnly("organizations.listMembers", ORGANIZATION_ADMIN),
  restOnly("organizations.addMember", ORGANIZATION_ADMIN),
  restOnly("organizations.updateMember", ORGANIZATION_ADMIN),
  restOnly("organizations.removeMember", ORGANIZATION_ADMIN),
  restOnly("organizations.listTeams", ORGANIZATION_ADMIN),
  restOnly("organizations.createTeam", ORGANIZATION_ADMIN),
  restOnly("organizations.getTeam", ORGANIZATION_ADMIN),
  restOnly("organizations.updateTeam", ORGANIZATION_ADMIN),
  restOnly("organizations.archiveTeam", ORGANIZATION_ADMIN),
  restOnly("organizations.enterTeam", ORGANIZATION_ADMIN),
  restOnly("organizations.listEsps", ORGANIZATION_ADMIN),
  restOnly("organizations.createEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.getEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.updateEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.testEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.activateEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.suspendEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.resumeEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.retireEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.deleteEsp", ORGANIZATION_ADMIN),
  restOnly("organizations.getEspFeedback", ORGANIZATION_ADMIN),
  restOnly("organizations.upsertEspFeedback", ORGANIZATION_ADMIN),
  restOnly("organizations.rotateEspFeedback", ORGANIZATION_ADMIN),
  restOnly("organizations.testEspFeedback", ORGANIZATION_ADMIN),
  restOnly("organizations.removeEspFeedback", ORGANIZATION_ADMIN),
  restOnly("organizations.getDeliveryPolicy", ORGANIZATION_ADMIN),
  restOnly("organizations.updateDeliveryPolicy", ORGANIZATION_ADMIN),
  restOnly("organizations.getUsage", ORGANIZATION_ADMIN),
  restOnly("organizations.getMailActivity", ORGANIZATION_ADMIN),
  restOnly("organizations.listAuditEvents", ORGANIZATION_ADMIN),
  restOnly("organizations.getEspGrant", ORGANIZATION_ADMIN),
  restOnly("organizations.upsertEspGrant", ORGANIZATION_ADMIN),
  restOnly("organizations.transitionEspGrant", ORGANIZATION_ADMIN),
  restOnly("organizations.listSendingDomains", ORGANIZATION_ADMIN),
  restOnly("organizations.createSendingDomain", ORGANIZATION_ADMIN),
  restOnly("organizations.verifySendingDomain", ORGANIZATION_ADMIN),
  restOnly("organizations.revokeSendingDomain", ORGANIZATION_ADMIN),
  restOnly("organizations.listKeys", ORGANIZATION_KEYS),
  restOnly("organizations.createKey", ORGANIZATION_KEYS),
  restOnly("organizations.revokeKey", ORGANIZATION_KEYS),

  // Team delivery-source selection
  restOnly("delivery.sendingOptions", DELIVERY_SELECTION),
  restOnly("delivery.getSettings", DELIVERY_SELECTION),
  restOnly("delivery.updateSettings", DELIVERY_SELECTION),

  // Organization-key provisioning
  restOnly("provisioning.getOrganization", PROVISIONING),
  restOnly("provisioning.provisionTeam", PROVISIONING),
  restOnly("provisioning.getTeam", PROVISIONING),
  restOnly("provisioning.updateTeam", PROVISIONING),
  restOnly("provisioning.createTeamKey", PROVISIONING),
  restOnly("provisioning.suspendTeam", PROVISIONING),
  restOnly("provisioning.resumeTeam", PROVISIONING),
  restOnly("provisioning.archiveTeam", PROVISIONING),
  restOnly("provisioning.getTeamUsage", PROVISIONING),

  // Dashboard overview
  restOnly(
    "overview.get",
    "REST-only dashboard helper that aggregates overview metrics; MCP clients use get_sequence_stats, list_emails and list_delivery_events directly.",
  ),

  // User ESP delivery feedback
  required("feedback.get", "get_esp_feedback_connection", "read"),
  required("feedback.upsert", "upsert_esp_feedback_connection", "write"),
  restOnly(
    "feedback.rotate",
    "REST-only rotate endpoint; over MCP, calling upsert_esp_feedback_connection on an existing connection rotates its credential.",
  ),
  required("feedback.test", "test_esp_feedback_connection", "write"),
  required("feedback.remove", "delete_esp_feedback_connection", "destructive"),

  // Delivery events and suppressions
  required("deliveryEvents.list", "list_delivery_events", "read"),
  required("deliveryEvents.get", "get_delivery_event", "read"),
  required("suppressions.list", "list_suppressions", "read"),
  required("suppressions.get", "get_suppression", "read"),
  required("suppressions.release", "release_suppression", "write"),

  // Billing
  required("billing.organizationPlanUsage", "get_plan_usage", "read"),
  restOnly("billing.actionToken", BILLING_SESSION_ONLY),
  restOnly("billing.organizationCheckout", BILLING_SESSION_ONLY),
  restOnly("billing.catalog", BILLING_SESSION_ONLY),
  restOnly("billing.organizationBilling", BILLING_SESSION_ONLY),
  restOnly("billing.checkout", BILLING_SESSION_ONLY),
  restOnly("billing.portal", BILLING_SESSION_ONLY),
  restOnly("billing.cancel", BILLING_SESSION_ONLY),
  restOnly("billing.resume", BILLING_SESSION_ONLY),
  restOnly("billing.changePlan", BILLING_SESSION_ONLY),
  restOnly("billing.getPlanChange", BILLING_SESSION_ONLY),
];
