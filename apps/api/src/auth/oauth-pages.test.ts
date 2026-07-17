import express from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn(async () => null as any);
const ensureSendLitAccountForBetterAuthUserId = vi.fn(async () => null as any);
const listTeamsForAccount = vi.fn(async () => [] as any[]);
const getOAuthTeamSelection = vi.fn(async () => null as string | null);
const getTeamByTeamId = vi.fn(async () => null as any);
const getTeamMembership = vi.fn(async () => null as any);
const setOAuthTeamSelection = vi.fn(async () => {});

vi.mock("./better-auth", () => ({
    webClientUrl: "http://localhost:3000",
    auth: { api: { getSession } },
    ensureSendLitAccountForBetterAuthUserId,
}));
vi.mock("better-auth/node", () => ({
    fromNodeHeaders: (headers: unknown) => headers,
}));
vi.mock("../team/queries", () => ({
    listTeamsForAccount,
    getOAuthTeamSelection,
    getTeamByTeamId,
    getTeamMembership,
    setOAuthTeamSelection,
}));

describe("Hosted login pages", () => {
    let app: express.Express;

    beforeEach(async () => {
        vi.clearAllMocks();
        getSession.mockResolvedValue(null);
        ensureSendLitAccountForBetterAuthUserId.mockResolvedValue(null);
        listTeamsForAccount.mockResolvedValue([]);
        getOAuthTeamSelection.mockResolvedValue(null);
        getTeamByTeamId.mockResolvedValue(null);
        getTeamMembership.mockResolvedValue(null);

        vi.resetModules();
        const oauthPagesRoutes = ((await import("./oauth-pages.js")) as any)
            .default;
        app = express();
        app.use(oauthPagesRoutes);
    });

    async function request(
        path: string,
        options: { method?: string; body?: unknown } = {},
    ) {
        const req = new IncomingMessage(new Socket());
        req.method = options.method ?? "GET";
        req.url = path;
        req.headers = { host: "localhost:4000" };
        if (options.body !== undefined) {
            req.headers["content-type"] = "application/json";
            const payload = Buffer.from(JSON.stringify(options.body));
            req.headers["content-length"] = String(payload.length);
            queueMicrotask(() => {
                req.emit("data", payload);
                req.emit("end");
            });
        }

        const res = new ServerResponse(req);
        const chunks: Buffer[] = [];

        const done = new Promise<{
            status: number;
            headers: ReturnType<ServerResponse["getHeaders"]>;
            body: string;
        }>((resolve) => {
            res.write = ((chunk: any, ...args: any[]) => {
                if (chunk) chunks.push(Buffer.from(chunk));
                const cb = args.find((arg) => typeof arg === "function");
                cb?.();
                return true;
            }) as typeof res.write;
            res.end = ((chunk: any, ...args: any[]) => {
                if (chunk) chunks.push(Buffer.from(chunk));
                const cb = args.find((arg) => typeof arg === "function");
                cb?.();
                resolve({
                    status: res.statusCode,
                    headers: res.getHeaders(),
                    body: Buffer.concat(chunks).toString("utf8"),
                });
                return res;
            }) as typeof res.end;
        });

        (app as any).handle(req, res);
        return done;
    }

    function jsonRequest(path: string, body: unknown) {
        return request(path, { method: "POST", body });
    }

    function redirectTargetFrom(body: string): string | undefined {
        return body.match(/var redirectTarget = "([^"]*)"/)?.[1];
    }

    describe("GET /login", () => {
        it("defaults to the web client root when no redirect is given", async () => {
            const res = await request("/login");

            expect(res.status).toBe(200);
            expect(redirectTargetFrom(res.body)).toBe("http://localhost:3000/");
        });

        it("honors a redirect on the web client's own origin", async () => {
            const res = await request(
                "/login?redirect=" +
                    encodeURIComponent("http://localhost:3000/sequences/foo"),
            );

            expect(redirectTargetFrom(res.body)).toBe(
                "http://localhost:3000/sequences/foo",
            );
        });

        it("rejects a redirect to a different origin (open-redirect protection)", async () => {
            const res = await request(
                "/login?redirect=" +
                    encodeURIComponent("http://evil.com/steal"),
            );

            expect(redirectTargetFrom(res.body)).toBe("http://localhost:3000/");
        });

        it("rejects a malformed redirect instead of throwing", async () => {
            const res = await request(
                "/login?redirect=" + encodeURIComponent("not-a-valid-url"),
            );

            expect(res.status).toBe(200);
            expect(redirectTargetFrom(res.body)).toBe("http://localhost:3000/");
        });

        it("sets anti-clickjacking headers", async () => {
            const res = await request("/login");

            expect(res.headers["content-security-policy"]).toBe(
                "frame-ancestors 'none'",
            );
            expect(res.headers["x-frame-options"]).toBe("DENY");
        });

        it("renders the same login form as /oauth/login", async () => {
            const res = await request("/login");

            expect(res.body).toContain('id="email-form"');
            expect(res.body).toContain('id="otp-form"');
            expect(res.body).toContain('id="google-submit"');
        });
    });

    describe("GET /oauth/login", () => {
        it("still renders the OAuth-flow login page (unaffected by the /login refactor)", async () => {
            const res = await request(
                "/oauth/login?client_id=abc&response_type=code",
            );

            expect(res.status).toBe(200);
            expect(res.body).toContain('id="email-form"');
            expect(res.body).toContain("oauth_query");
            expect(res.body).not.toContain("redirectTarget");
        });
    });

    const session = {
        user: { id: "user-1", email: "owner@example.com" },
        session: { id: "session-1" },
    };
    const teamA = { id: "internal-a", teamId: "team_aaa", name: "Team A" };
    const teamB = { id: "internal-b", teamId: "team_bbb", name: "Team B" };

    describe("GET /oauth/select-team", () => {
        it("sends an unauthenticated visitor back through login", async () => {
            getSession.mockResolvedValue(null);

            const res = await request(
                "/oauth/select-team?client_id=abc&scope=contacts:read",
            );

            expect(res.status).toBe(302);
            expect(res.headers.location).toBe(
                "/oauth/login?client_id=abc&scope=contacts:read",
            );
        });

        it("auto-continues instead of showing a picker for a single-team account", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            listTeamsForAccount.mockResolvedValue([teamA]);

            const res = await request("/oauth/select-team?client_id=abc");

            expect(res.status).toBe(200);
            expect(res.body).toContain("oauth2/continue");
            expect(res.body).not.toContain('class="team-option"');
        });

        it("renders a radio option per team, using the public team id as the value", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            listTeamsForAccount.mockResolvedValue([teamA, teamB]);

            const res = await request("/oauth/select-team?client_id=abc");

            expect(res.status).toBe(200);
            expect(res.body).toContain(`value="${teamA.teamId}"`);
            expect(res.body).toContain(`value="${teamB.teamId}"`);
            expect(res.body).not.toContain(teamA.id);
            expect(res.body).not.toContain(teamB.id);
            expect(res.body).toContain("Team A");
            expect(res.body).toContain("Team B");
        });
    });

    describe("POST /oauth/select-team", () => {
        it("rejects an unauthenticated request", async () => {
            getSession.mockResolvedValue(null);

            const res = await jsonRequest("/oauth/select-team", {
                teamId: teamA.teamId,
            });

            expect(res.status).toBe(401);
        });

        it("requires a teamId", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });

            const res = await jsonRequest("/oauth/select-team", {});

            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toBe("invalid_request");
        });

        it("rejects an unknown team id", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            getTeamByTeamId.mockResolvedValue(null);

            const res = await jsonRequest("/oauth/select-team", {
                teamId: "team_doesnotexist",
            });

            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toBe("invalid_team_id");
        });

        it("rejects a team the account doesn't belong to", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            getTeamByTeamId.mockResolvedValue(teamB);
            getTeamMembership.mockResolvedValue(null);

            const res = await jsonRequest("/oauth/select-team", {
                teamId: teamB.teamId,
            });

            expect(res.status).toBe(403);
            expect(JSON.parse(res.body).error).toBe("not_a_team_member");
        });

        it("records the selection against the internal team id, keyed by session", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            getTeamByTeamId.mockResolvedValue(teamB);
            getTeamMembership.mockResolvedValue({ role: "owner" });

            const res = await jsonRequest("/oauth/select-team", {
                teamId: teamB.teamId,
            });

            expect(res.status).toBe(200);
            expect(setOAuthTeamSelection).toHaveBeenCalledWith(
                session.session.id,
                teamB.id,
            );
        });
    });

    describe("GET /oauth/consent", () => {
        it("shows the previously selected team for a multi-team account", async () => {
            getSession.mockResolvedValue(session);
            ensureSendLitAccountForBetterAuthUserId.mockResolvedValue({
                id: "account-1",
            });
            listTeamsForAccount.mockResolvedValue([teamA, teamB]);
            getOAuthTeamSelection.mockResolvedValue(teamB.id);

            const res = await request(
                "/oauth/consent?client_id=abc&scope=contacts:read",
            );

            expect(res.status).toBe(200);
            expect(res.body).toContain("Team B");
            expect(res.body).not.toContain("Team A");
        });

        it("omits the team line entirely for an unauthenticated visitor", async () => {
            getSession.mockResolvedValue(null);

            const res = await request(
                "/oauth/consent?client_id=abc&scope=contacts:read",
            );

            expect(res.status).toBe(200);
            expect(res.body).not.toContain('class="team-name"');
        });
    });
});
