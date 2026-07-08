import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const captureExceptionMock = vi.fn();
const captureMock = vi.fn();
const setupExpressErrorHandlerMock = vi.fn();
const posthogConstructorMock = vi.fn(function () {
    return {
        captureException: captureExceptionMock,
        capture: captureMock,
    };
});

vi.mock("posthog-node", () => ({
    PostHog: posthogConstructorMock,
    setupExpressErrorHandler: setupExpressErrorHandlerMock,
}));

const loadModule = async () => {
    vi.resetModules();
    return await import("./posthog.js");
};

describe("posthog wrapper", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.POSTHOG_API_KEY;
        delete process.env.POSTHOG_ERROR_CAP_PER_SOURCE_PER_MINUTE;
        delete process.env.DEPLOY_ENV;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("is no-op when POSTHOG_API_KEY is missing", async () => {
        const module = await loadModule();
        module.captureError({
            error: new Error("boom"),
            source: "worker.mail",
            teamId: "team-1",
        });

        expect(module.isPosthogEnabled()).toBe(false);
        expect(posthogConstructorMock).not.toHaveBeenCalled();
        expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it("captures exception when POSTHOG_API_KEY is present", async () => {
        process.env.POSTHOG_API_KEY = "phc_test_key";
        const module = await loadModule();

        const error = new Error("smtp failed");
        module.captureError({
            error,
            source: "worker.mail",
            teamId: "team-1",
            context: {
                job_id: "42",
                queue_name: "mail",
                not_allowed: "dropped",
            },
        });

        expect(module.isPosthogEnabled()).toBe(true);
        expect(captureExceptionMock).toHaveBeenCalledTimes(1);
        const [capturedError, distinctId, properties] =
            captureExceptionMock.mock.calls[0];
        expect(capturedError).toBe(error);
        expect(distinctId).toBe("team-1");
        expect(properties.service).toBe("sendlit:api");
        expect(properties.team_id).toBe("team-1");
        expect(properties.job_id).toBe("42");
        expect(properties.queue_name).toBe("mail");
        expect(properties.not_allowed).toBeUndefined();
    });

    it("dedupes identical errors within the TTL window", async () => {
        process.env.POSTHOG_API_KEY = "phc_test_key";
        const module = await loadModule();

        const error = new Error("boom");
        module.captureError({ error, source: "worker.mail" });
        module.captureError({ error, source: "worker.mail" });

        expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to the system team id", async () => {
        const module = await loadModule();
        expect(module.getTeamId()).toBe("system");
        expect(module.getTeamId("  ")).toBe("system");
        expect(module.getTeamId("team-9")).toBe("team-9");
    });

    it("captures events with sanitized properties", async () => {
        process.env.POSTHOG_API_KEY = "phc_test_key";
        const module = await loadModule();

        module.captureEvent({
            event: "mail_sent",
            source: "worker.mail",
            teamId: "team-1",
            properties: { queue_name: "mail", secret_stuff: "dropped" },
        });

        expect(captureMock).toHaveBeenCalledTimes(1);
        const [{ event, distinctId, properties }] = captureMock.mock.calls[0];
        expect(event).toBe("mail_sent");
        expect(distinctId).toBe("team-1");
        expect(properties.queue_name).toBe("mail");
        expect(properties.secret_stuff).toBeUndefined();
    });
});
