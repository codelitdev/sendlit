import express from "express";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import { db } from "../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import contactsRoutes from "../contacts/routes";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb(), pool: { end: vi.fn() } };
});

const tdb = db as unknown as TestDb;

const mocks = vi.hoisted(() => ({
    ensureSendLitAccountForBetterAuthUserId: vi.fn(),
    verifyAccessToken: vi.fn(),
}));

vi.mock("./better-auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(async () => null),
        },
    },
    authIssuer: "https://sendlit.test/api/auth",
    ensureSendLitAccountForBetterAuthUserId:
        mocks.ensureSendLitAccountForBetterAuthUserId,
    ensureSendLitAccountForUser: vi.fn(),
    mcpProtectedResourceMetadataUrl:
        "https://sendlit.test/.well-known/oauth-protected-resource/mcp",
    mcpResourceUrl: "https://sendlit.test/mcp",
    validOAuthAudiences: ["https://sendlit.test", "https://sendlit.test/mcp"],
    oauthResourceClient: {
        getActions: vi.fn(() => ({
            verifyAccessToken: mocks.verifyAccessToken,
        })),
    },
}));

vi.mock("better-auth/node", () => ({
    fromNodeHeaders: vi.fn((headers) => headers),
}));

async function request(
    router: express.Router,
    path: string,
    init?: RequestInit,
) {
    const bodyChunks: Buffer[] = [];
    const headers = new Map<string, string | number | readonly string[]>();

    const req = Object.create(express.request) as any;
    req.method = init?.method ?? "GET";
    req.url = path;
    req.originalUrl = path;
    req.query = {};
    req.headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
    ) as Record<string, string>;
    req.app = { get: () => undefined };

    const res = Object.create(express.response) as any;
    req.res = res;
    res.req = req;
    res.app = req.app;
    res.statusCode = 200;
    res.setHeader = (
        name: string,
        value: string | number | readonly string[],
    ) => headers.set(name.toLowerCase(), value);
    res.getHeader = (name: string) => headers.get(name.toLowerCase());
    res.getHeaders = () => Object.fromEntries(headers.entries());
    res.removeHeader = (name: string) => headers.delete(name.toLowerCase());
    res.writeHead = (
        statusCode: number,
        responseHeaders?: Record<string, string>,
    ) => {
        res.statusCode = statusCode;
        for (const [name, value] of Object.entries(responseHeaders ?? {})) {
            res.setHeader(name, value);
        }
        return res;
    };
    res.end = (
        chunk?: string | Buffer,
        _encoding?: BufferEncoding,
        callback?: () => void,
    ) => {
        if (chunk) bodyChunks.push(Buffer.from(chunk));
        callback?.();
        resolveResponse();
        return res;
    };

    let resolveResponse!: () => void;
    const finished = new Promise<void>((resolve) => {
        resolveResponse = resolve;
    });

    (router as any).handle(req, res, (error: unknown) => {
        if (error) throw error;
        resolveResponse();
    });
    await finished;

    return {
        status: res.statusCode as number,
        async json() {
            return JSON.parse(Buffer.concat(bodyChunks).toString("utf8"));
        },
    };
}

describe("REST bearer token authentication", () => {
    beforeEach(async () => {
        await truncateAll(tdb);
        mocks.ensureSendLitAccountForBetterAuthUserId.mockReset();
        mocks.verifyAccessToken.mockReset();
    });

    afterAll(async () => {
        await tdb.$client.close();
    });

    it("accepts a Better Auth OAuth access token on REST routes", async () => {
        const { account, team, contact } = await seedTeamAndContact(tdb, {
            account: { email: "owner@example.com" },
            contact: { email: "reader@example.com" },
        });
        await tdb.insert(schema.teamMembers).values({
            teamId: team.id,
            accountId: account.id,
            role: "owner",
        });
        await tdb.insert(schema.authUser).values({
            id: "better-auth-user-1",
            email: account.email,
            name: "Owner",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        mocks.verifyAccessToken.mockResolvedValueOnce({
            sub: "better-auth-user-1",
            azp: "sendlit-local-token",
            scope: "contacts:read",
        });
        mocks.ensureSendLitAccountForBetterAuthUserId.mockResolvedValueOnce(
            account,
        );

        const response = await request(contactsRoutes, "/contacts", {
            headers: { authorization: "Bearer valid-oauth-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            total: 1,
            items: [
                {
                    contactId: contact.contactId,
                    email: "reader@example.com",
                },
            ],
        });
        expect(mocks.verifyAccessToken).toHaveBeenCalledWith(
            "valid-oauth-token",
            expect.any(Object),
        );
    });
});
