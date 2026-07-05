import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@sendlit/api-contract";
import { createOpenAPI } from "fumadocs-openapi/server";

const openApiDocument = generateOpenApi(
    contract,
    {
        info: {
            title: "SendLit API",
            description:
                "OAuth2 protected REST API for composing, sending and automating email.",
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
                description: "Manage contacts and segmentation.",
            },
            { name: "Templates", description: "Reusable email templates." },
            {
                name: "Sequences",
                description:
                    "Broadcasts and multi-step, event-triggered sequences.",
            },
            {
                name: "Settings",
                description:
                    "Per-team settings, including SMTP configuration and test sends.",
            },
            {
                name: "Teams",
                description:
                    "Team management, API keys, and server-to-server provisioning.",
            },
        ],
        components: {
            securitySchemes: {
                OAuth2: {
                    type: "oauth2",
                    flows: {
                        authorizationCode: {
                            authorizationUrl: "/oauth/authorize",
                            tokenUrl: "/oauth/token",
                            scopes: {},
                        },
                    },
                },
                ApiKey: {
                    type: "apiKey",
                    in: "header",
                    name: "X-API-Key",
                },
            },
        },
        security: [{ OAuth2: [] }, { ApiKey: [] }],
    },
    {
        setOperationId: true,
    },
);

export const openapi = createOpenAPI({
    input: () => {
        return {
            "sendlit-openapi": openApiDocument as any,
        };
    },
});
