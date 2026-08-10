import { describe, expect, it } from "vitest";
import { createSendLitMcpAuthInfo } from "./auth-context";

describe("SendLit MCP auth context", () => {
    it("keeps tenant identity separate from OAuth client identity", () => {
        const auth = createSendLitMcpAuthInfo({
            authKind: "oauth",
            oauthToken: "oauth-token",
            clientId: "oauth-client",
            scopes: ["contacts:read"],
            teamId: "team-1",
            user: { id: "user-1" },
        });

        expect(auth).toMatchObject({
            token: "oauth-token",
            clientId: "oauth-client",
            scopes: ["contacts:read"],
            extra: {
                authKind: "oauth",
                teamId: "team-1",
            },
        });
        expect(auth?.clientId).not.toBe(auth?.extra.teamId);
    });

    it("never places an API-key secret in AuthInfo", () => {
        const auth = createSendLitMcpAuthInfo({
            authKind: "team_key",
            apiKeyId: "tak_public",
            apikey: "sl_live_secret",
            teamId: "team-1",
        });

        expect(auth).toMatchObject({
            token: "tak_public",
            clientId: "team-key:tak_public",
            extra: {
                authKind: "team_key",
                teamId: "team-1",
            },
        });
        expect(JSON.stringify(auth)).not.toContain("sl_live_secret");
    });
});
