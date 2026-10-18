import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../auth/better-auth", () => ({
    auth: { api: { getSession: authMocks.getSession } },
}));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { organizations } from "../db/schema";
import { truncateAll, type TestDb } from "../test/db";
import { issueBillingActionToken, requireBillingAction } from "./security";

const tdb = db as unknown as TestDb;

function request(headers: Record<string, string> = {}) {
    return {
        authKind: "session",
        userId: "user-1",
        headers: {
            origin: "http://localhost:3000",
            cookie: "sendlit_csrf=csrf-value",
            "x-sendlit-csrf": "csrf-value",
            ...headers,
        },
    };
}

const response = { append: vi.fn() };

beforeEach(async () => {
    process.env.WEB_CLIENT = "http://localhost:3000";
    process.env.API_PUBLIC_URL = "http://localhost:5000";
    process.env.BILLING_RECENT_AUTH_MAX_AGE_SECONDS = "900";
    response.append.mockClear();
    authMocks.getSession.mockReset();
    await truncateAll(tdb);
});

describe("billing action authorization", () => {
    it("issues a target-bound token that can be consumed only once", async () => {
        const createdAt = new Date();
        authMocks.getSession.mockResolvedValue({
            user: { id: "user-1" },
            session: { id: "session-1", createdAt, updatedAt: createdAt },
        });
        const issued = await issueBillingActionToken(
            request(),
            response,
            "checkout",
            "org_1",
        );
        expect("token" in issued).toBe(true);
        if (!("token" in issued)) throw new Error("token_not_issued");

        const authorizedRequest = request({
            "x-sendlit-billing-action-token": issued.token,
        });
        await expect(
            requireBillingAction(
                authorizedRequest,
                response,
                "checkout",
                "org_1",
            ),
        ).resolves.toBeNull();
        await expect(
            requireBillingAction(
                authorizedRequest,
                response,
                "checkout",
                "org_1",
            ),
        ).resolves.toMatchObject({
            status: 401,
            body: { error: "billing_action_token_invalid" },
        });
    });

    it("does not treat an ordinary session refresh as recent authentication", async () => {
        authMocks.getSession.mockResolvedValue({
            user: { id: "user-1" },
            session: {
                id: "session-1",
                createdAt: new Date(Date.now() - 60 * 60 * 1000),
                updatedAt: new Date(),
            },
        });

        await expect(
            issueBillingActionToken(request(), response, "checkout", "org_1"),
        ).resolves.toEqual({
            status: 401,
            body: { error: "recent_authentication_required" },
        });
    });

    it("lets resume checkout finish a pending organization without recent authentication", async () => {
        await tdb.insert(organizations).values({
            organizationId: "org_pending",
            name: "Pending org",
            status: "pending_payment",
        });
        authMocks.getSession.mockResolvedValue({
            user: { id: "user-1" },
            session: {
                id: "session-1",
                createdAt: new Date(Date.now() - 60 * 60 * 1000),
                updatedAt: new Date(),
            },
        });

        const issued = await issueBillingActionToken(
            request(),
            response,
            "checkout",
            "org_pending",
        );
        expect("token" in issued).toBe(true);
    });

    it("still requires recent authentication to start checkout on an active organization", async () => {
        await tdb.insert(organizations).values({
            organizationId: "org_active",
            name: "Active org",
            status: "active",
        });
        authMocks.getSession.mockResolvedValue({
            user: { id: "user-1" },
            session: {
                id: "session-1",
                createdAt: new Date(Date.now() - 60 * 60 * 1000),
                updatedAt: new Date(),
            },
        });

        await expect(
            issueBillingActionToken(
                request(),
                response,
                "checkout",
                "org_active",
            ),
        ).resolves.toEqual({
            status: 401,
            body: { error: "recent_authentication_required" },
        });
        await expect(
            issueBillingActionToken(
                request(),
                response,
                "organization_checkout",
                "new",
            ),
        ).resolves.toEqual({
            status: 401,
            body: { error: "recent_authentication_required" },
        });
    });
});
