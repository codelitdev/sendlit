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
});
