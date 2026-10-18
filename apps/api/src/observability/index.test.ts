import { describe, expect, it, mock } from "bun:test";
import type { CaptureClient } from "@codelitdev/observability";
import { getTeamId } from ".";
import { createSendLitObservability } from "./instance";

function fakeClient() {
  return {
    captureException: mock(),
    capture: mock(),
    shutdown: mock(async () => {}),
  } satisfies CaptureClient;
}

const env = { POSTHOG_API_KEY: "phc_test_key", NODE_ENV: "test" };

describe("SendLit observability", () => {
  it("is a no-op without POSTHOG_API_KEY", () => {
    const client = fakeClient();
    const observability = createSendLitObservability({}, { client });

    observability.captureException({ error: new Error("boom"), source: "worker.mail" });

    expect(observability.enabled).toBe(false);
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it("captures errors with allowlisted context only", () => {
    const client = fakeClient();
    const observability = createSendLitObservability(env, { client });
    const error = new Error("smtp failed");

    observability.captureException({
      error,
      source: "worker.mail",
      subjectId: "team-1",
      context: { job_id: "42", queue_name: "mail", not_allowed: "dropped" },
    });

    expect(client.captureException).toHaveBeenCalledTimes(1);
    const [captured, distinctId, properties] = client.captureException.mock.calls[0];
    expect(captured.message).toBe("smtp failed");
    expect(distinctId).toBe("team-1");
    expect(properties.service).toBe("sendlit:api");
    expect(properties.job_id).toBe("42");
    expect(properties.queue_name).toBe("mail");
    expect(properties.not_allowed).toBeUndefined();
  });

  it("dedupes identical errors within the TTL window", () => {
    const client = fakeClient();
    const observability = createSendLitObservability(env, { client });
    const error = new Error("boom");

    observability.captureException({ error, source: "worker.mail" });
    observability.captureException({ error, source: "worker.mail" });

    expect(client.captureException).toHaveBeenCalledTimes(1);
  });

  it("caps errors per source per minute", () => {
    const client = fakeClient();
    const observability = createSendLitObservability(
      { ...env, POSTHOG_ERROR_CAP_PER_SOURCE_PER_MINUTE: "2" },
      { client },
    );

    for (const message of ["a", "b", "c"]) {
      const error = new Error(message);
      error.stack = `Error: ${message}\n    at frame-${message}`;
      observability.captureException({ error, source: "worker.mail" });
    }

    expect(client.captureException).toHaveBeenCalledTimes(2);
  });

  it("captures every product event, without dedupe or caps", () => {
    const client = fakeClient();
    const events = createSendLitObservability(
      { ...env, POSTHOG_ERROR_CAP_PER_SOURCE_PER_MINUTE: "1" },
      { client, purpose: "events" },
    );

    for (let i = 0; i < 3; i++) {
      events.captureEvent({
        event: "email_sent",
        source: "mail.send",
        subjectId: "team-1",
        properties: { queue_name: "mail", secret_stuff: "dropped" },
      });
    }

    expect(client.capture).toHaveBeenCalledTimes(3);
    const [{ event, distinctId, properties }] = client.capture.mock.calls[0];
    expect(event).toBe("email_sent");
    expect(distinctId).toBe("team-1");
    expect(properties.queue_name).toBe("mail");
    expect(properties.secret_stuff).toBeUndefined();
  });

  it("falls back to the system team id", () => {
    expect(getTeamId()).toBe("system");
    expect(getTeamId("  ")).toBe("system");
    expect(getTeamId("team-9")).toBe("team-9");
  });
});
