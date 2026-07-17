import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@sendlit/api-contract";

export const openApiDocument = generateOpenApi(
    contract,
    {
        info: {
            title: "SendLit API",
            description:
                "SendLit REST API for composing, sending and automating email. Authenticate with a team-scoped API key or a Better Auth OAuth2 bearer token.",
            version: "0.1.0",
        },
        servers: [
            {
                url: "{protocol}://{host}",
                description: "API Server",
                variables: {
                    protocol: { default: "https", enum: ["https", "http"] },
                    host: { default: "api.sendlit.dev" },
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
        ],
        components: {
            securitySchemes: {
                apiKeyAuth: {
                    type: "apiKey",
                    in: "header",
                    name: "x-sendlit-apikey",
                },
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
                provisioningSecretAuth: {
                    type: "apiKey",
                    in: "header",
                    name: "X-Sendlit-Provisioning-Secret",
                },
            },
        },
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
    },
    {
        operationMapper: (operation, route) => {
            const path = (route as { path?: string }).path;

            return {
                ...operation,
                tags: (route.metadata as { tag?: string } | undefined)?.tag
                    ? [(route.metadata as { tag: string }).tag]
                    : operation.tags,
                security:
                    path === "/provisioning/teams"
                        ? [{ provisioningSecretAuth: [] }]
                        : operation.security,
            };
        },
    },
);
