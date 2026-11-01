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
const ACCOUNT_DELETION =
  "Deleting an account is dashboard-session only and needs a code emailed to the person; MCP and API keys must never be able to erase a person's account.";
const ORGANIZATION_ADMIN =
  "Organization administration (members, teams, shared ESPs, feedback, delivery policy, sending domains, usage and audit) is organization-scoped; MCP is team-scoped and accepts neither organization sessions nor organization API keys.";
const ORGANIZATION_KEYS =
  "Organization API key management is REST-only; MCP is team-scoped and never handles organization credentials.";
const PROVISIONING =
  "Team provisioning authenticates with organization API keys; MCP is team-scoped and does not accept organization keys.";
const ESP_LIFECYCLE =
  "ESP suspend and resume are operational lifecycle controls kept REST/dashboard-only; MCP exposes create, activate, test, retire and delete.";
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
  required("contacts.events", "get_contact_events", "read"),
  required("contacts.remove", "delete_contact", "destructive"),
  required("contacts.previewBulkDelete", "preview_delete_contacts", "read"),
  required("contacts.bulkDelete", "delete_contacts", "destructive"),
  required("contacts.bulkDeleteStatus", "get_contact_deletion", "read"),

  // Tags
  required("tags.list", "list_tags", "read"),
  required("tags.references", "get_tag_references", "read"),
  required("tags.rename", "rename_tag", "write"),
  required("tags.remove", "delete_tag", "destructive"),

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
  required("sequences.remove", "delete_sequence", "destructive"),
  required("sequences.deletionPreview", "preview_sequence_deletion", "read"),
  required("sequences.archive", "archive_broadcast", "write"),
  required("sequences.unarchive", "unarchive_broadcast", "write"),
  required("sequences.addEmail", "add_sequence_email", "write"),
  required("sequences.updateEmail", "update_sequence_email", "write"),
  required("contacts.import", "import_contacts", "write"),
  required("suppressions.create", "add_suppression", "write"),
  required("forms.list", "list_signup_forms", "read"),
  required("forms.create", "create_signup_form", "write"),
  required("forms.get", "get_signup_form", "read"),
  required("forms.update", "update_signup_form", "write"),
  required("forms.remove", "delete_signup_form", "destructive"),
  required("contacts.export", "export_contacts", "read"),
  required("sequences.sendEmailTest", "send_sequence_email_test", "write"),
  required("sequences.removeEmail", "delete_sequence_email", "destructive"),
  required("sequences.start", "start_sequence", "write"),
  required("sequences.pause", "pause_sequence", "write"),
  required("sequences.stats", "get_sequence_stats", "read"),
  required("sequences.schedule", "get_sequence_schedule", "read"),
  required("sequences.waitingContacts", "list_sequence_email_waiting_contacts", "read"),
  required("sequences.getWeb", "get_broadcast_web_publishing", "read"),
  required("sequences.updateWeb", "update_broadcast_web_publishing", "write"),
  required("web.list", "list_web_issues", "read"),
  required("web.get", "get_web_issue", "read"),
  required("reputation.get", "get_reputation", "read"),
  required("reputation.connectGoogle", "connect_google_postmaster", "write"),
  required(
    "reputation.disconnectGoogle",
    "disconnect_google_postmaster",
    "destructive",
  ),
  required("reputation.connectSnds", "connect_snds", "write"),
  required("reputation.disconnectSnds", "disconnect_snds", "destructive"),
  required("reputation.sync", "sync_reputation", "write"),
  required("sequences.subscribers", "get_sequence_subscribers", "read"),

  // Transactional email
  required("transactional.send", "send_email", "write"),
  required("transactional.get", "get_email", "read"),
  required("transactional.list", "list_emails", "read"),

  // Custom events
  required("events.track", "track_event", "write"),
  required("events.definitions", "list_event_definitions", "read"),
  required("events.definition", "get_event_definition", "read"),
  required("events.createDefinition", "create_event_definition", "write"),
  required("events.updateDefinition", "update_event_definition", "write"),
  required("events.deleteDefinition", "delete_event_definition", "destructive"),

  // User-managed ESPs
  required("settings.esps.list", "list_esps", "read"),
  required("settings.esps.create", "create_esp", "write"),
  required("settings.esps.get", "get_esp", "read"),
  required("settings.esps.update", "update_esp", "write"),
  required("settings.esps.remove", "delete_esp", "destructive"),
  required("settings.esps.test", "test_esp", "write"),
  required(
    "settings.esps.domainAuthentication",
    "check_esp_domain_authentication",
    "read",
  ),
  required("settings.esps.activate", "activate_esp", "write"),
  restOnly("settings.esps.suspend", ESP_LIFECYCLE),
  restOnly("settings.esps.resume", ESP_LIFECYCLE),
  required("settings.esps.retire", "retire_esp", "destructive"),
  mcpOnly("get_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("update_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("delete_esp_config", DEFAULT_ESP_ALIAS),
  mcpOnly("send_test_email", DEFAULT_ESP_ALIAS),

  // General settings
  required("settings.general.get", "get_general_settings", "read"),
  required("settings.general.update", "update_general_settings", "write"),
  required("settings.trackingDomain.get", "get_tracking_domain", "read"),
  required("settings.trackingDomain.update", "set_tracking_domain", "write"),
  required("settings.trackingDomain.verify", "verify_tracking_domain", "write"),
  required("settings.web.get", "get_web_settings", "read"),
  required("settings.web.update", "update_web_settings", "write"),

  // Teams and team API keys
  required("teams.list", "list_teams", "read"),
  required("teams.create", "create_team", "write"),
  required("teams.rename", "rename_team", "write"),
  required("teams.remove", "delete_team", "destructive"),
  required("teams.listKeys", "list_api_keys", "read"),
  required("teams.createKey", "create_api_key", "write"),
  required("teams.removeKey", "delete_api_key", "destructive"),

  // Organization administration
  restOnly("account.getDeletion", ACCOUNT_DELETION),
  restOnly("account.sendDeletionCode", ACCOUNT_DELETION),
  restOnly("account.delete", ACCOUNT_DELETION),
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
