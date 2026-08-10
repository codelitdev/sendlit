import type { ServerContext } from "@modelcontextprotocol/server";
import { errorResult } from "./tools/responses";

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

const toolPolicies = {
    list_contacts: MCP_SCOPES.contactsRead,
    get_contact: MCP_SCOPES.contactsRead,
    get_contact_deliveries: MCP_SCOPES.contactsRead,
    create_contact: MCP_SCOPES.contactsWrite,
    update_contact: MCP_SCOPES.contactsWrite,
    delete_contact: MCP_SCOPES.contactsWrite,
    add_contact_tag: MCP_SCOPES.contactsWrite,
    remove_contact_tag: MCP_SCOPES.contactsWrite,

    list_segments: MCP_SCOPES.contactsRead,
    get_segment: MCP_SCOPES.contactsRead,
    create_segment: MCP_SCOPES.contactsWrite,
    update_segment: MCP_SCOPES.contactsWrite,
    delete_segment: MCP_SCOPES.contactsWrite,

    list_system_templates: MCP_SCOPES.templatesRead,
    list_templates: MCP_SCOPES.templatesRead,
    get_template: MCP_SCOPES.templatesRead,
    create_template: MCP_SCOPES.templatesWrite,
    update_template: MCP_SCOPES.templatesWrite,
    duplicate_template: MCP_SCOPES.templatesWrite,
    delete_template: MCP_SCOPES.templatesWrite,

    list_media: MCP_SCOPES.mediaRead,
    get_media: MCP_SCOPES.mediaRead,
    list_media_references: MCP_SCOPES.mediaRead,
    update_media: MCP_SCOPES.mediaWrite,
    delete_media: MCP_SCOPES.mediaWrite,

    list_sequences: MCP_SCOPES.sequencesRead,
    get_sequence: MCP_SCOPES.sequencesRead,
    get_sequence_stats: MCP_SCOPES.sequencesRead,
    get_sequence_subscribers: MCP_SCOPES.sequencesRead,
    create_sequence: MCP_SCOPES.sequencesWrite,
    update_sequence: MCP_SCOPES.sequencesWrite,
    add_sequence_email: MCP_SCOPES.sequencesWrite,
    update_sequence_email: MCP_SCOPES.sequencesWrite,
    delete_sequence_email: MCP_SCOPES.sequencesWrite,
    start_sequence: MCP_SCOPES.sequencesWrite,
    pause_sequence: MCP_SCOPES.sequencesWrite,

    get_email: MCP_SCOPES.emailsRead,
    list_emails: MCP_SCOPES.emailsRead,
    send_email: MCP_SCOPES.emailsSend,

    get_general_settings: MCP_SCOPES.settingsRead,
    update_general_settings: MCP_SCOPES.settingsWrite,

    get_esp_config: MCP_SCOPES.espRead,
    list_esps: MCP_SCOPES.espRead,
    get_esp: MCP_SCOPES.espRead,
    update_esp_config: MCP_SCOPES.espWrite,
    delete_esp_config: MCP_SCOPES.espWrite,
    send_test_email: MCP_SCOPES.espWrite,
    create_esp: MCP_SCOPES.espWrite,
    update_esp: MCP_SCOPES.espWrite,
    delete_esp: MCP_SCOPES.espWrite,
    test_esp: MCP_SCOPES.espWrite,
    activate_esp: MCP_SCOPES.espWrite,

    list_teams: MCP_SCOPES.teamsRead,
    create_team: MCP_SCOPES.teamsWrite,
    rename_team: MCP_SCOPES.teamsWrite,
    delete_team: MCP_SCOPES.teamsWrite,
    list_api_keys: MCP_SCOPES.apiKeysRead,
    create_api_key: MCP_SCOPES.apiKeysWrite,
    delete_api_key: MCP_SCOPES.apiKeysWrite,

    get_esp_feedback_connection: MCP_SCOPES.feedbackRead,
    upsert_esp_feedback_connection: MCP_SCOPES.feedbackWrite,
    test_esp_feedback_connection: MCP_SCOPES.feedbackWrite,
    delete_esp_feedback_connection: MCP_SCOPES.feedbackWrite,
    list_delivery_events: MCP_SCOPES.deliveryEventsRead,
    get_delivery_event: MCP_SCOPES.deliveryEventsRead,
    list_suppressions: MCP_SCOPES.suppressionsRead,
    get_suppression: MCP_SCOPES.suppressionsRead,
    release_suppression: MCP_SCOPES.suppressionsWrite,
} as const satisfies Record<string, McpScope>;

export type McpToolName = keyof typeof toolPolicies;

export function isMcpToolName(name: string): name is McpToolName {
    return Object.prototype.hasOwnProperty.call(toolPolicies, name);
}

export function getRequiredScope(name: string): McpScope {
    if (!isMcpToolName(name)) {
        throw new Error(`MCP tool '${name}' has no authorization policy.`);
    }
    return toolPolicies[name];
}

export function authorizeMcpTool(name: string, ctx: ServerContext) {
    const requiredScope = getRequiredScope(name);
    const authInfo = ctx.http?.authInfo;
    const authKind = authInfo?.extra?.authKind;

    if (!authInfo) {
        return errorResult("Authentication required.");
    }

    // A team API key is already a full-access credential for exactly one team.
    // Scoped team keys are a separate API-key product feature.
    if (authKind === "team_key") return null;

    if (authKind !== "oauth" || !authInfo.scopes.includes(requiredScope)) {
        return errorResult(
            `insufficient_scope: this tool requires '${requiredScope}'.`,
        );
    }

    return null;
}

export function listMcpToolPolicies(): Readonly<Record<McpToolName, McpScope>> {
    return toolPolicies;
}
