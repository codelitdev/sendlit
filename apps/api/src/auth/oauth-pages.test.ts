import express from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./better-auth", () => ({
    webClientUrl: "http://localhost:3000",
}));

describe("Hosted login pages", () => {
    let app: express.Express;

    beforeEach(async () => {
        vi.resetModules();
        const oauthPagesRoutes = ((await import("./oauth-pages.js")) as any)
            .default;
        app = express();
        app.use(oauthPagesRoutes);
    });

    async function request(path: string) {
        const req = new IncomingMessage(new Socket());
        req.method = "GET";
        req.url = path;
        req.headers = { host: "localhost:4000" };

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

    function redirectTargetFrom(body: string): string | undefined {
        return body.match(/var redirectTarget = "([^"]*)"/)?.[1];
    }

    describe("GET /login", () => {
        it("defaults to the web client's dashboard when no redirect is given", async () => {
            const res = await request("/login");

            expect(res.status).toBe(200);
            expect(redirectTargetFrom(res.body)).toBe(
                "http://localhost:3000/dashboard",
            );
        });

        it("honors a redirect on the web client's own origin", async () => {
            const res = await request(
                "/login?redirect=" +
                    encodeURIComponent("http://localhost:3000/dashboard/foo"),
            );

            expect(redirectTargetFrom(res.body)).toBe(
                "http://localhost:3000/dashboard/foo",
            );
        });

        it("rejects a redirect to a different origin (open-redirect protection)", async () => {
            const res = await request(
                "/login?redirect=" +
                    encodeURIComponent("http://evil.com/steal"),
            );

            expect(redirectTargetFrom(res.body)).toBe(
                "http://localhost:3000/dashboard",
            );
        });

        it("rejects a malformed redirect instead of throwing", async () => {
            const res = await request(
                "/login?redirect=" + encodeURIComponent("not-a-valid-url"),
            );

            expect(res.status).toBe(200);
            expect(redirectTargetFrom(res.body)).toBe(
                "http://localhost:3000/dashboard",
            );
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
});
