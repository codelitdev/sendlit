import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@sendlit/api-contract";

type AuthMode =
    | "teamOrUser"
    | "user"
    | "dashboardSession"
    | "organization"
    | "userOrOrganization"
    | "public";

const securityByAuthMode: Record<AuthMode, Array<Record<string, string[]>>> = {
    teamOrUser: [
        { teamApiKey: [] },
        { userAccessToken: [] },
        { dashboardSession: [] },
        { dashboardSecureSession: [] },
    ],
    user: [
        { userAccessToken: [] },
        { dashboardSession: [] },
        { dashboardSecureSession: [] },
    ],
    dashboardSession: [
        { dashboardSession: [] },
        { dashboardSecureSession: [] },
    ],
    organization: [{ organizationApiKey: [] }],
    userOrOrganization: [
        { userAccessToken: [] },
        { dashboardSession: [] },
        { dashboardSecureSession: [] },
        { organizationApiKey: [] },
    ],
    public: [],
};

const authenticationDescriptions: Record<AuthMode, string> = {
    teamOrUser:
        "Requires a team API key or a user OAuth access token. Dashboard session cookies are also accepted.",
    user: "Requires a user OAuth access token or a dashboard session cookie.",
    dashboardSession:
        "Requires a dashboard session cookie; OAuth access tokens and API keys are not accepted. Requests must pass the dashboard's same-origin and CSRF checks. Sensitive billing actions require recent authentication and a single-use billing action token; POST /billing/action-token issues that token.",
    organization:
        "Requires a scoped organization API key sent as a Bearer token.",
    userOrOrganization:
        "Requires a user OAuth access token or dashboard session, or a scoped organization API key. The caller must also have the required organization role or key scope.",
    public: "No authentication is required.",
};

const dashboardSessionOnlyOperations = new Set([
    "POST /billing/action-token",
    "POST /billing/organization-checkouts",
    "DELETE /organizations/:organizationId",
    "POST /organizations/:organizationId/abandon",
    "POST /organizations/:organizationId/billing/checkout",
    "POST /organizations/:organizationId/billing/portal",
    "POST /organizations/:organizationId/billing/plan-change",
]);

function getAuthMode(path: string, method: string): AuthMode {
    const verb = method.toUpperCase();

    if (dashboardSessionOnlyOperations.has(`${verb} ${path}`)) {
        return "dashboardSession";
    }
    if (path === "/billing/catalog") return "public";
    if (path.startsWith("/provisioning/")) return "organization";
    if (path.startsWith("/teams")) return "user";
    if (path.startsWith("/billing/")) return "user";

    if (path.startsWith("/organizations")) {
        if (
            path === "/organizations" ||
            (path === "/organizations/:organizationId" && verb !== "GET") ||
            path.includes("/members") ||
            path.includes("/keys") ||
            path.endsWith("/abandon") ||
            path.includes("/sending-domains") ||
            path.endsWith("/enter") ||
            path.includes("/billing/") ||
            path.endsWith("/plan-usage")
        ) {
            return "user";
        }

        const organizationKeyRoutes =
            (path === "/organizations/:organizationId" && verb === "GET") ||
            path === "/organizations/:organizationId/teams" ||
            path === "/organizations/:organizationId/teams/:teamId" ||
            path.startsWith("/organizations/:organizationId/esps") ||
            path === "/organizations/:organizationId/usage" ||
            path === "/organizations/:organizationId/mail-activity" ||
            path === "/organizations/:organizationId/audit-events" ||
            path === "/organizations/:organizationId/delivery-policy" ||
            path === "/organizations/:organizationId/teams/:teamId/esp-grant" ||
            path ===
                "/organizations/:organizationId/teams/:teamId/esp-grant/transition";

        // These routes authorize either a human member or an organization
        // key with the operation's required scope. Unknown organization routes
        // default to user authentication until explicitly reviewed here.
        return organizationKeyRoutes ? "userOrOrganization" : "user";
    }

    return "teamOrUser";
}

export const openApiDocument = generateOpenApi(
    contract,
    {
        info: {
            title: "SendLit API",
            description:
                "SendLit REST API for composing, sending and automating email. Most team-scoped routes accept a team API key or Better Auth OAuth2 bearer token. Provisioning and selected organization routes accept scoped organization API keys; some routes require user authentication.",
            version: "0.1.0",
        },
        servers: [
            {
                url: "{protocol}://{host}",
                description: "API Server",
                variables: {
                    protocol: { default: "https", enum: ["https", "http"] },
                    host: { default: "api.sendlit.app" },
                },
            },
        ],
        tags: [
            {
                name: "Contacts",
                description: "Manage contacts (subscribers).",
            },
            {
                name: "Segments",
                description:
                    "Saved, named, reusable contact filters - build a filter once, reuse it across broadcasts and sequences.",
            },
            {
                name: "Media",
                description:
                    "Authenticated MediaLit upload signatures for dashboard-owned media.",
            },
            { name: "Templates", description: "Reusable email templates." },
            {
                name: "Sequences",
                description:
                    "Broadcasts (one-off) and sequences (multi-step, event-triggered).",
            },
            {
                name: "Transactional Emails",
                description:
                    "Single API-triggered sends (receipts, password resets, ...) — no audience filter, no unsubscribe footer, delivered immediately.",
            },
            {
                name: "Settings",
                description:
                    "Per-team settings, including email sending provider (SMTP) configuration and test sends.",
            },
            {
                name: "Teams",
                description:
                    "Team management (list/create/rename/delete), per-team API keys, and server-to-server provisioning.",
            },
            {
                name: "Delivery",
                description:
                    "Normalized bounce/complaint delivery events and the per-workspace suppression (do-not-send) list. See docs/bounces-and-complaints.md.",
            },
            {
                name: "Billing",
                description:
                    "Organization-scoped plan, configured catalog, entitlement, and usage information.",
            },
        ],
        components: {
            securitySchemes: {
                teamApiKey: {
                    type: "apiKey",
                    in: "header",
                    name: "x-sendlit-apikey",
                    description:
                        "Team-scoped API key (sl_live_...) for REST requests.",
                },
                userAccessToken: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description:
                        "Better Auth OAuth access token for a user. Dashboard session cookies are also accepted on user-authenticated routes.",
                },
                dashboardSession: {
                    type: "apiKey",
                    in: "cookie",
                    name: "sendlit.session_token",
                    description:
                        "Better Auth dashboard session cookie used for local HTTP connections.",
                },
                dashboardSecureSession: {
                    type: "apiKey",
                    in: "cookie",
                    name: "__Secure-sendlit.session_token",
                    description:
                        "Better Auth dashboard session cookie used over HTTPS.",
                },
                organizationApiKey: {
                    type: "http",
                    scheme: "bearer",
                    description:
                        "Scoped organization API key (sl_org_live_...) sent as Authorization: Bearer <key>.",
                },
            },
        },
        security: [{ teamApiKey: [] }, { userAccessToken: [] }],
    },
    {
        operationMapper: (operation, route) => {
            const authMode = getAuthMode(route.path, route.method);
            const authDescription = `**Authentication:** ${
                authenticationDescriptions[authMode]
            }`;
            return {
                ...operation,
                tags: (route.metadata as { tag?: string } | undefined)?.tag
                    ? [(route.metadata as { tag: string }).tag]
                    : operation.tags,
                description: operation.description
                    ? `${operation.description}\n\n${authDescription}`
                    : authDescription,
                security: securityByAuthMode[authMode],
            };
        },
    },
);
