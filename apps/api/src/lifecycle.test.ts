import { describe, expect, it } from "bun:test";
import { checkReadiness, createApiShutdown } from "./lifecycle";

describe("readiness", () => {
  it("is ready only after startup and while dependencies answer", async () => {
    const ok = async () => {};
    expect(
      (await checkReadiness({ started: false, shuttingDown: false }, { database: ok }))
        .status,
    ).toBe("not_ready");
    expect(
      await checkReadiness({ started: true, shuttingDown: false }, { database: ok }),
    ).toEqual({
      status: "ready",
      checks: { started: true, accepting_requests: true, database: true },
    });
  });

  it("reports a failing dependency or shutdown without throwing", async () => {
    const report = await checkReadiness(
      { started: true, shuttingDown: true },
      {
        database: async () => {},
        redis: async () => {
          throw new Error("connection refused");
        },
      },
    );
    expect(report.status).toBe("not_ready");
    expect(report.checks).toEqual({
      started: true,
      accepting_requests: false,
      database: true,
      redis: false,
    });
  });
});

describe("shutdown", () => {
  it("closes the server first, then runs every step in order", async () => {
    const order: string[] = [];
    const shutdown = createApiShutdown({
      server: {
        close(callback?: (error?: Error) => void) {
          order.push("server");
          callback?.();
          return this as never;
        },
      },
      steps: [
        { name: "worker", run: async () => void order.push("worker") },
        {
          name: "flaky",
          run: () => {
            order.push("flaky");
            throw new Error("already closed");
          },
        },
        { name: "database", run: async () => void order.push("database") },
      ],
    });

    await shutdown.shutdown();
    await shutdown.shutdown();

    expect(order).toEqual(["server", "worker", "flaky", "database"]);
    expect(shutdown.shuttingDown()).toBe(true);
  });

  it("gives up after the timeout", async () => {
    const shutdown = createApiShutdown({
      server: {
        close(callback?: () => void) {
          callback?.();
          return this as never;
        },
      },
      steps: [{ name: "stuck", run: () => new Promise(() => {}) }],
      timeoutMs: 20,
    });
    await expect(shutdown.shutdown()).rejects.toThrow("shutdown_timeout");
  });
});
