import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    contactsList: vi.fn(),
}));

vi.mock("@ts-rest/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@ts-rest/core")>();
    return {
        ...actual,
        initClient: () => ({
            contacts: {
                list: mocks.contactsList,
            },
        }),
    };
});

function installWindow(pathname = "/sequences") {
    const location = { href: pathname, pathname };
    vi.stubGlobal("window", { location });
    return location;
}

describe("dashboard API client auth handling", () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.contactsList.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("redirects to login on any 401 response", async () => {
        const location = installWindow();
        mocks.contactsList.mockResolvedValue({
            status: 401,
            body: { error: "unauthorized" },
        });

        const { listContacts } = await import("./api");
        void listContacts();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(location.href).toBe("/login");
    });

    it("does not sign out on billing recent-authentication 401", async () => {
        const location = installWindow("/organizations");
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/api/auth/sign-out")) {
                return new Response(null, { status: 204 });
            }
            return new Response(
                JSON.stringify({ error: "recent_authentication_required" }),
                {
                    status: 401,
                    headers: { "content-type": "application/json" },
                },
            );
        });
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("document", { cookie: "" });

        const { createOrganizationBillingCheckout } = await import("./api");
        await expect(
            createOrganizationBillingCheckout("org_cB2kKmowUP3UeOHPYpzcp8S6", {
                plan: "pro",
                interval: "month",
                catalogRevision: 1,
            }),
        ).rejects.toMatchObject({
            status: 401,
            message: "recent_authentication_required",
        });
        expect(location.href).toBe("/organizations");
        expect(
            fetchMock.mock.calls.some(([url]) =>
                String(url).includes("/api/proxy/billing/action-token"),
            ),
        ).toBe(true);
        expect(
            fetchMock.mock.calls.some(
                ([url, init]) =>
                    String(url).includes("/api/auth/sign-out") &&
                    (init as RequestInit | undefined)?.method === "POST",
            ),
        ).toBe(false);
    });
});
