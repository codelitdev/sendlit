import type { Server } from "node:http";
import {
  createGracefulShutdown,
  type GracefulShutdown,
  type ReadinessReport,
  readinessReport,
} from "@codelitdev/platform";
import logger from "./services/log";

export type ProcessState = { started: boolean; shuttingDown: boolean };

/**
 * `/ready` is false until startup finishes and again once shutdown starts, so
 * a load balancer stops routing before connections drain. Dependency checks
 * run on every call and never throw.
 */
export async function checkReadiness(
  state: ProcessState,
  dependencies: Record<string, () => Promise<unknown>>,
): Promise<ReadinessReport> {
  const checks = await Promise.all(
    Object.entries(dependencies).map(async ([name, check]) => {
      try {
        await check();
        return { name, ready: true };
      } catch {
        return { name, ready: false };
      }
    }),
  );
  return readinessReport([
    { name: "started", ready: state.started },
    { name: "accepting_requests", ready: !state.shuttingDown },
    ...checks,
  ]);
}

/**
 * One ordered shutdown: stop taking HTTP requests, let workers finish their
 * current jobs, then release Redis, Postgres and telemetry. Later steps depend
 * on earlier ones, so they run in sequence under one overall timeout.
 */
export function createApiShutdown(input: {
  server: Pick<Server, "close">;
  steps: ReadonlyArray<{ name: string; run: () => Promise<unknown> | unknown }>;
  timeoutMs?: number;
}): GracefulShutdown {
  return createGracefulShutdown({
    timeoutMs: input.timeoutMs ?? 25_000,
    hooks: [
      async () => {
        await new Promise<void>((resolve) => input.server.close(() => resolve()));
        for (const step of input.steps) {
          try {
            await step.run();
          } catch (error) {
            logger.warn(
              { step: step.name, error: (error as Error)?.message },
              "Shutdown step failed",
            );
          }
        }
      },
    ],
  });
}
