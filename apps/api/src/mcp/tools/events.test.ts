import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

class FakeEventsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const trackEvent = vi.fn();
mock.module("../../events/queries", () => ({
  EventsError: FakeEventsError,
  trackEvent,
}));

const { eventTools } = await import("./events");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};
const [tool] = eventTools();
function call(args: unknown): Promise<any> {
  return tool!.handler({ context, args, signal });
}

beforeEach(() => trackEvent.mockReset());

describe("MCP track_event", () => {
  it("is the only dedicated event tool", () => {
    expect(eventTools().map((t) => t.name)).toEqual(["track_event"]);
    expect(tool!.risk).toBe("write");
  });

  it("tracks an event for the resolved team with source mcp", async () => {
    trackEvent.mockResolvedValue({
      eventId: "evt_1",
      contactId: "cnt_1",
      duplicate: false,
      contactCreated: true,
    });
    await expect(
      call({
        email: "a@example.com",
        eventName: " course purchased ",
        properties: { price: 49 },
        idempotencyKey: "order_1",
      }),
    ).resolves.toMatchObject({ eventId: "evt_1" });
    expect(trackEvent).toHaveBeenCalledWith({
      teamId: "team-1",
      source: "mcp",
      body: expect.objectContaining({
        email: "a@example.com",
        eventName: "course purchased",
        idempotencyKey: "order_1",
      }),
    });
  });

  it("validates with the REST rules and maps expected errors", async () => {
    const invalid = await call({ eventName: "course purchased" });
    expect(invalid.error.code).toBe("validation_failed");
    expect(invalid.error.safeDetails.reason).toBe("invalid_event");
    expect(invalid.error.safeDetails.message).toContain(
      "exactly one of email or contactId",
    );
    expect(trackEvent).not.toHaveBeenCalled();

    trackEvent.mockRejectedValue(new FakeEventsError("contact_not_found"));
    await expect(
      call({ email: "a@example.com", eventName: "x", createContact: false }),
    ).resolves.toMatchObject({
      error: { code: "not_found", safeDetails: { reason: "contact_not_found" } },
    });

    trackEvent.mockRejectedValue(new FakeEventsError("event_name_limit_reached"));
    await expect(
      call({ email: "a@example.com", eventName: "x" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "event_name_limit_reached" },
      },
    });
  });
});
