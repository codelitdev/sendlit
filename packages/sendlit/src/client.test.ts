import { afterEach, describe, expect, it, vi } from "vitest";
import { SendLit, DEFAULT_ENDPOINT } from "./client";
import { SendLitError } from "./errors";
import { mockSendLit } from "./test-utils";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("SendLit configuration", () => {
    it("sends a team key in x-sendlit-apikey", async () => {
        const { sendlit, requests } = mockSendLit();
        await sendlit.contacts.get("con_1");
        expect(requests[0].headers["x-sendlit-apikey"]).toBe("sl_live_test");
        expect(requests[0].headers.authorization).toBeUndefined();
    });

    it("sends an organization key as a Bearer token", async () => {
        const { sendlit, requests } = mockSendLit(undefined, {
            apiKey: "sl_org_live_abc",
        });
        await sendlit.provisioning.getTeam("team_1");
        expect(requests[0].headers.authorization).toBe(
            "Bearer sl_org_live_abc",
        );
        expect(requests[0].headers["x-sendlit-apikey"]).toBeUndefined();
    });

    it("sends an access token as a Bearer token with the team id", async () => {
        const { sendlit, requests } = mockSendLit(undefined, {
            apiKey: undefined,
            accessToken: "oauth-token",
            teamId: "team_42",
        });
        await sendlit.contacts.list();
        expect(requests[0].headers.authorization).toBe("Bearer oauth-token");
        expect(requests[0].headers["x-sendlit-team-id"]).toBe("team_42");
        expect(requests[0].headers["x-sendlit-apikey"]).toBeUndefined();
    });

    it("falls back to environment variables", async () => {
        vi.stubEnv("SENDLIT_API_KEY", "sl_live_env");
        vi.stubEnv("SENDLIT_ENDPOINT", "https://self-hosted.test/");
        vi.stubEnv("SENDLIT_TEAM_ID", "team_env");
        const { sendlit, requests } = mockSendLit(undefined, {
            apiKey: undefined,
            endpoint: undefined,
        });
        await sendlit.contacts.get("con_1");
        expect(requests[0].url.href).toBe(
            "https://self-hosted.test/contacts/con_1",
        );
        expect(requests[0].headers["x-sendlit-apikey"]).toBe("sl_live_env");
        expect(requests[0].headers["x-sendlit-team-id"]).toBe("team_env");
    });

    it("defaults to the hosted endpoint", async () => {
        vi.stubEnv("SENDLIT_ENDPOINT", "");
        const { sendlit, requests } = mockSendLit(undefined, {
            endpoint: undefined,
        });
        await sendlit.segments.list();
        expect(requests[0].url.origin).toBe(DEFAULT_ENDPOINT);
    });

    it("requires credentials", () => {
        vi.stubEnv("SENDLIT_API_KEY", "");
        expect(() => new SendLit()).toThrow(/Missing credentials/);
    });

    it("rejects both an API key and an access token", () => {
        expect(
            () => new SendLit({ apiKey: "sl_live_x", accessToken: "t" }),
        ).toThrow(/either apiKey or accessToken/);
    });

    it("refuses to run in a browser", () => {
        vi.stubGlobal("window", { document: {} });
        expect(() => new SendLit({ apiKey: "sl_live_x" })).toThrow(
            /server-only/,
        );
    });
});

describe("ID validation", () => {
    it.each(["", "../teams", "con_1/tags", "a?b=c", "con 1"])(
        "rejects %j before sending a request",
        async (id) => {
            const { sendlit, fetch } = mockSendLit();
            await expect(sendlit.contacts.get(id)).rejects.toMatchObject({
                code: "invalid_argument",
            });
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it("rejects an invalid team id at construction", () => {
        expect(
            () => new SendLit({ apiKey: "sl_live_x", teamId: "../x" }),
        ).toThrow(/Invalid teamId/);
    });

    it("URL-encodes tag names", async () => {
        const { sendlit, requests } = mockSendLit();
        await sendlit.contacts.addTag("con_1", "plan/pro & more");
        expect(requests[0].url.pathname).toBe(
            "/contacts/con_1/tags/plan%2Fpro%20%26%20more",
        );
    });

    it("rejects an empty tag", async () => {
        const { sendlit } = mockSendLit();
        await expect(sendlit.contacts.removeTag("con_1", " ")).rejects.toThrow(
            /Invalid tag/,
        );
    });
});

describe("errors", () => {
    it("maps an API error body to SendLitError", async () => {
        const { sendlit } = mockSendLit({
            status: 404,
            body: { error: "contact_not_found" },
        });
        const error = await sendlit.contacts.get("con_1").catch((e) => e);
        expect(error).toBeInstanceOf(SendLitError);
        expect(error).toMatchObject({
            status: 404,
            code: "contact_not_found",
            message: "contact_not_found",
            body: { error: "contact_not_found" },
        });
    });

    it("prefers error_description for the message", async () => {
        const { sendlit } = mockSendLit({
            status: 403,
            body: {
                error: "not_a_team_member",
                error_description: "You are not a member of this team.",
            },
        });
        await expect(sendlit.contacts.list()).rejects.toMatchObject({
            code: "not_a_team_member",
            message: "You are not a member of this team.",
        });
    });

    it("maps request-validation 400s to validation_error", async () => {
        const { sendlit } = mockSendLit({
            status: 400,
            body: {
                message: "Request validation failed",
                bodyErrors: { issues: [] },
            },
        });
        await expect(
            sendlit.contacts.create({ email: "nope" }),
        ).rejects.toMatchObject({
            status: 400,
            code: "validation_error",
            message: "Request validation failed",
        });
    });

    it("keeps extra error fields on body", async () => {
        const body = {
            error: "missing_template_variables",
            missingVariables: ["name"],
        };
        const { sendlit } = mockSendLit({ status: 422, body });
        await expect(
            sendlit.emails.send({
                to: "a@example.com",
                subject: "Hi",
                templateId: "tpl_1",
            }),
        ).rejects.toMatchObject({ code: "missing_template_variables", body });
    });

    it("wraps network failures", async () => {
        const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
        const sendlit = new SendLit({
            apiKey: "sl_live_x",
            fetch,
            maxRetries: 0,
        });
        await expect(sendlit.contacts.get("con_1")).rejects.toMatchObject({
            status: 0,
            code: "connection_error",
        });
    });
});

describe("retries", () => {
    it("retries a GET on 5xx", async () => {
        const { sendlit, fetch } = mockSendLit([
            { status: 503, body: { error: "unavailable" } },
            { status: 200, body: { contactId: "con_1" } },
        ]);
        await expect(sendlit.contacts.get("con_1")).resolves.toEqual({
            contactId: "con_1",
        });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("honours Retry-After on 429, even for non-idempotent calls", async () => {
        const { sendlit, fetch } = mockSendLit([
            {
                status: 429,
                body: { error: "too_many_requests" },
                headers: { "retry-after": "0" },
            },
            { status: 200, body: { sequenceId: "seq_1" } },
        ]);
        await sendlit.sequences.start("seq_1");
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry a non-idempotent POST on 5xx", async () => {
        const { sendlit, fetch } = mockSendLit({
            status: 500,
            body: { error: "server_error" },
        });
        await expect(sendlit.sequences.start("seq_1")).rejects.toMatchObject({
            status: 500,
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries a send only when it has an idempotency key", async () => {
        const failure = { status: 502, body: { error: "bad_gateway" } };
        const input = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" };

        const withoutKey = mockSendLit(failure);
        await expect(withoutKey.sendlit.emails.send(input)).rejects.toThrow();
        expect(withoutKey.fetch).toHaveBeenCalledTimes(1);

        const withKey = mockSendLit([
            failure,
            { status: 202, body: { txeId: "txe_1", status: "queued" } },
        ]);
        await expect(
            withKey.sendlit.emails.send({ ...input, idempotencyKey: "k1" }),
        ).resolves.toEqual({ txeId: "txe_1", status: "queued" });
        expect(withKey.fetch).toHaveBeenCalledTimes(2);
    });

    it("gives up after maxRetries", async () => {
        const { sendlit, fetch } = mockSendLit(
            { status: 500, body: { error: "server_error" } },
            { maxRetries: 1 },
        );
        await expect(sendlit.contacts.list()).rejects.toMatchObject({
            status: 500,
            code: "server_error",
        });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry 4xx", async () => {
        const { sendlit, fetch } = mockSendLit({
            status: 404,
            body: { error: "not_found" },
        });
        await expect(sendlit.contacts.get("con_1")).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
