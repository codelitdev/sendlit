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
const API_DISCOVERY =
  "MCP-only discovery for the generic api.* tools: it lists and describes the REST operations themselves, so it has no REST operation of its own.";

/**
 * The generic MCP tools (ADR 0010). Common flows have dedicated tools; every
 * other MCP-reachable REST operation runs through the api.* tool for its risk,
 * after api.list_operations and api.describe_operation.
 */
export const MCP_API_TOOLS = {
  read: "api.read",
  write: "api.write",
  destructive: "api.delete",
} as const;

export const mcpParityManifest: readonly McpParityManifestEntry[] = [
  mcpOnly("api.list_operations", API_DISCOVERY),
  mcpOnly("api.describe_operation", API_DISCOVERY),

  // Contacts
  required("contacts.create", "create_contact", "write"),
  required("contacts.list", "list_contacts", "read"),
  required("contacts.get", "get_contact", "read"),
  required("contacts.update", "update_contact", "write"),
  required("contacts.addTag", "add_contact_tag", "write"),
  required("contacts.removeTag", "remove_contact_tag", "write"),
  required("contacts.deliveries", MCP_API_TOOLS.read, "read"),
  required("contacts.events", MCP_API_TOOLS.read, "read"),
  required("contacts.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("contacts.previewBulkDelete", MCP_API_TOOLS.read, "read"),
  required("contacts.bulkDelete", MCP_API_TOOLS.destructive, "destructive"),
  required("contacts.bulkDeleteStatus", MCP_API_TOOLS.read, "read"),

  // Tags
  required("tags.list", MCP_API_TOOLS.read, "read"),
  required("tags.references", MCP_API_TOOLS.read, "read"),
  required("tags.rename", MCP_API_TOOLS.write, "write"),
  required("tags.remove", MCP_API_TOOLS.destructive, "destructive"),

  // Segments
  required("segments.create", "create_segment", "write"),
  required("segments.list", "list_segments", "read"),
  required("segments.get", MCP_API_TOOLS.read, "read"),
  required("segments.update", MCP_API_TOOLS.write, "write"),
  required("segments.remove", MCP_API_TOOLS.destructive, "destructive"),

  // Media
  required("media.list", MCP_API_TOOLS.read, "read"),
  restOnly(
    "media.presigned",
    "REST-only upload helper: issues a MediaLit browser upload signature for the dashboard's direct file upload, which has no MCP transport.",
  ),
  required("media.get", MCP_API_TOOLS.read, "read"),
  required("media.update", MCP_API_TOOLS.write, "write"),
  required("media.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("media.references", MCP_API_TOOLS.read, "read"),

  // Templates
  required("templates.listSystem", MCP_API_TOOLS.read, "read"),
  required("templates.create", "create_template", "write"),
  required("templates.list", "list_templates", "read"),
  required("templates.get", "get_template", "read"),
  required("templates.update", "update_template", "write"),
  required("templates.duplicate", MCP_API_TOOLS.write, "write"),
  required("templates.remove", MCP_API_TOOLS.destructive, "destructive"),

  // Broadcasts and sequences
  required("sequences.create", "create_sequence", "write"),
  required("sequences.list", "list_sequences", "read"),
  required("sequences.get", "get_sequence", "read"),
  required("sequences.update", "update_sequence", "write"),
  required("sequences.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("sequences.deletionPreview", MCP_API_TOOLS.read, "read"),
  required("sequences.archive", MCP_API_TOOLS.write, "write"),
  required("sequences.unarchive", MCP_API_TOOLS.write, "write"),
  required("sequences.addEmail", "add_sequence_email", "write"),
  required("sequences.updateEmail", "update_sequence_email", "write"),
  required("contacts.import", "import_contacts", "write"),
  required("suppressions.create", MCP_API_TOOLS.write, "write"),
  required("forms.list", MCP_API_TOOLS.read, "read"),
  required("forms.create", MCP_API_TOOLS.write, "write"),
  required("forms.get", MCP_API_TOOLS.read, "read"),
  required("forms.update", MCP_API_TOOLS.write, "write"),
  required("forms.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("contacts.export", MCP_API_TOOLS.read, "read"),
  required("sequences.sendEmailTest", "send_sequence_email_test", "write"),
  required("sequences.removeEmail", MCP_API_TOOLS.destructive, "destructive"),
  required("sequences.start", "start_sequence", "write"),
  required("sequences.pause", "pause_sequence", "write"),
  required("sequences.stats", "get_sequence_stats", "read"),
  required("sequences.schedule", MCP_API_TOOLS.read, "read"),
  required("sequences.waitingContacts", MCP_API_TOOLS.read, "read"),
  required("sequences.getWeb", MCP_API_TOOLS.read, "read"),
  required("sequences.updateWeb", MCP_API_TOOLS.write, "write"),
  required("web.list", MCP_API_TOOLS.read, "read"),
  required("web.get", MCP_API_TOOLS.read, "read"),
  required("reputation.get", MCP_API_TOOLS.read, "read"),
  required("reputation.connectGoogle", MCP_API_TOOLS.write, "write"),
  required("reputation.disconnectGoogle", MCP_API_TOOLS.destructive, "destructive"),
  required("reputation.connectSnds", MCP_API_TOOLS.write, "write"),
  required("reputation.disconnectSnds", MCP_API_TOOLS.destructive, "destructive"),
  required("reputation.sync", MCP_API_TOOLS.write, "write"),
  required("sequences.subscribers", MCP_API_TOOLS.read, "read"),

  // Transactional email
  required("transactional.send", "send_email", "write"),
  required("transactional.get", "get_email", "read"),
  required("transactional.list", "list_emails", "read"),

  // Custom events
  required("events.track", "track_event", "write"),
  required("events.definitions", MCP_API_TOOLS.read, "read"),
  required("events.definition", MCP_API_TOOLS.read, "read"),
  required("events.createDefinition", MCP_API_TOOLS.write, "write"),
  required("events.updateDefinition", MCP_API_TOOLS.write, "write"),
  required("events.deleteDefinition", MCP_API_TOOLS.destructive, "destructive"),

  // User-managed ESPs
  required("settings.esps.list", MCP_API_TOOLS.read, "read"),
  required("settings.esps.create", MCP_API_TOOLS.write, "write"),
  required("settings.esps.get", MCP_API_TOOLS.read, "read"),
  required("settings.esps.update", MCP_API_TOOLS.write, "write"),
  required("settings.esps.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("settings.esps.test", MCP_API_TOOLS.write, "write"),
  required("settings.esps.domainAuthentication", MCP_API_TOOLS.read, "read"),
  required("settings.esps.activate", MCP_API_TOOLS.write, "write"),
  restOnly("settings.esps.suspend", ESP_LIFECYCLE),
  restOnly("settings.esps.resume", ESP_LIFECYCLE),
  required("settings.esps.retire", MCP_API_TOOLS.destructive, "destructive"),

  // General settings
  required("settings.general.get", MCP_API_TOOLS.read, "read"),
  required("settings.general.update", MCP_API_TOOLS.write, "write"),
  required("settings.trackingDomain.get", MCP_API_TOOLS.read, "read"),
  required("settings.trackingDomain.update", MCP_API_TOOLS.write, "write"),
  required("settings.trackingDomain.verify", MCP_API_TOOLS.write, "write"),
  required("settings.web.get", MCP_API_TOOLS.read, "read"),
  required("settings.web.update", MCP_API_TOOLS.write, "write"),

  // Teams and team API keys
  required("teams.list", MCP_API_TOOLS.read, "read"),
  required("teams.create", MCP_API_TOOLS.write, "write"),
  required("teams.rename", MCP_API_TOOLS.write, "write"),
  required("teams.remove", MCP_API_TOOLS.destructive, "destructive"),
  required("teams.listKeys", MCP_API_TOOLS.read, "read"),
  required("teams.createKey", MCP_API_TOOLS.write, "write"),
  required("teams.removeKey", MCP_API_TOOLS.destructive, "destructive"),

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
  required("feedback.get", MCP_API_TOOLS.read, "read"),
  required("feedback.upsert", MCP_API_TOOLS.write, "write"),
  restOnly(
    "feedback.rotate",
    "REST-only rotate endpoint; over MCP, calling upsert_esp_feedback_connection on an existing connection rotates its credential.",
  ),
  required("feedback.test", MCP_API_TOOLS.write, "write"),
  required("feedback.remove", MCP_API_TOOLS.destructive, "destructive"),

  // Delivery events and suppressions
  required("deliveryEvents.list", "list_delivery_events", "read"),
  required("deliveryEvents.get", MCP_API_TOOLS.read, "read"),
  required("suppressions.list", MCP_API_TOOLS.read, "read"),
  required("suppressions.get", MCP_API_TOOLS.read, "read"),
  required("suppressions.release", MCP_API_TOOLS.write, "write"),

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
