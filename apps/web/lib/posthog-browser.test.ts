import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock("posthog-js", () => ({
    default: {
        init: mocks.init,
        identify: mocks.identify,
        reset: mocks.reset,
    },
}));

vi.stubGlobal("fetch", mocks.fetch);

const loadModule = async () => {
    vi.resetModules();
    return await import("./posthog-browser");
};

describe("posthog browser wrapper", () => {
    beforeEach(() => {
        mocks.init.mockReset();
        mocks.identify.mockReset();
        mocks.reset.mockReset();
        mocks.register.mockReset();
        mocks.fetch.mockReset();
        mocks.init.mockImplementation(
            (
                _key: string,
                options?: { loaded?: (client: { register: unknown }) => void },
            ) => {
                options?.loaded?.({ register: mocks.register });
            },
        );
    });

    it("does not load the SDK when the key is empty", async () => {
        const browser = await loadModule();

        await browser.initPosthogBrowser({
            apiKey: "",
            host: "https://us.i.posthog.com",
            environment: "test",
        });

        expect(mocks.init).not.toHaveBeenCalled();
        expect(browser.isPosthogBrowserInitialized()).toBe(false);
    });

    it("does not init twice and registers service properties", async () => {
        const browser = await loadModule();

        await Promise.all([
            browser.initPosthogBrowser({
                apiKey: "phc_test",
                host: "https://us.i.posthog.com",
                environment: "test",
            }),
            browser.initPosthogBrowser({
                apiKey: "phc_test",
                host: "https://us.i.posthog.com",
                environment: "test",
            }),
        ]);

        expect(mocks.init).toHaveBeenCalledTimes(1);
        expect(mocks.init).toHaveBeenCalledWith("phc_test", {
            api_host: "https://us.i.posthog.com",
            defaults: "2026-05-30",
            loaded: expect.any(Function),
        });
        expect(mocks.register).toHaveBeenCalledWith({
            service: "sendlit:web",
            environment: "test",
        });
        expect(browser.isPosthogBrowserInitialized()).toBe(true);
    });

    it("identifies with a stable user id and person properties", async () => {
        const browser = await loadModule();
        await browser.initPosthogBrowser({
            apiKey: "phc_test",
            host: "https://us.i.posthog.com",
            environment: "test",
        });

        browser.identifyPosthogUser({
            id: "user_123",
            email: "ada@example.com",
            name: "Ada",
        });

        expect(mocks.identify).toHaveBeenCalledWith("user_123", {
            email: "ada@example.com",
            name: "Ada",
        });
    });

    it("does not identify without a user id", async () => {
        const browser = await loadModule();
        await browser.initPosthogBrowser({
            apiKey: "phc_test",
            host: "https://us.i.posthog.com",
            environment: "test",
        });

        browser.identifyPosthogUser({ email: "ada@example.com" });
        browser.identifyPosthogUser(null);

        expect(mocks.identify).not.toHaveBeenCalled();
    });

    it("identifies from the session endpoint", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    user: { id: "user_123", email: "ada@example.com" },
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        const browser = await loadModule();
        await browser.initPosthogBrowser({
            apiKey: "phc_test",
            host: "https://us.i.posthog.com",
            environment: "test",
        });

        await browser.identifyPosthogUserFromSession();

        expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/get-session", {
            cache: "no-store",
        });
        expect(mocks.identify).toHaveBeenCalledWith("user_123", {
            email: "ada@example.com",
        });
    });

    it("resets identity on logout after init", async () => {
        const browser = await loadModule();
        browser.resetPosthogUser();
        expect(mocks.reset).not.toHaveBeenCalled();

        await browser.initPosthogBrowser({
            apiKey: "phc_test",
            host: "https://us.i.posthog.com",
            environment: "test",
        });
        browser.resetPosthogUser();
        expect(mocks.reset).toHaveBeenCalledTimes(1);
    });
});
