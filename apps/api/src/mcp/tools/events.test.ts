import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

class FakeEventsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const trackEvent = vi.fn();
const queries = {
  listEventDefinitions: vi.fn(),
  getEventDefinition: vi.fn(),
  createEventDefinition: vi.fn(),
  updateEventDefinition: vi.fn(),
  deleteEventDefinition: vi.fn(),
  listContactEvents: vi.fn(),
};
const getContactByContactId = vi.fn();
mock.module("../../events/queries", () => ({
  EventsError: FakeEventsError,
  trackEvent,
  ...queries,
}));
// contacts.test.ts mocks the same module; bun shares mocks across files run
// in one process, so both list every export either one needs.
mock.module("../../contacts/queries", () => ({
  getContactByContactId,
  countContacts: vi.fn(),
  createContact: vi.fn(),
  listContacts: vi.fn(),
  updateContact: vi.fn(),
  addTagToContact: vi.fn(),
  removeTagFromContact: vi.fn(),
  deleteContact: vi.fn(),
  getDeliveriesByContact: vi.fn(),
}));

const { eventTools } = await import("./events");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
};
const tools = new Map(eventTools().map((t) => [t.name, t]));
const tool = tools.get("track_event");
function callTool(name: string, args: unknown, ctx: any = context): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal });
}
function call(args: unknown): Promise<any> {
  return tool!.handler({ context, args, signal });
}

beforeEach(() => {
  for (const fn of [trackEvent, getContactByContactId, ...Object.values(queries)]) {
    fn.mockReset();
  }
});

describe("MCP track_event", () => {
  it("has one titled tool per event operation", () => {
    expect(eventTools().map((t) => t.name)).toEqual([
      "track_event",
      "list_event_definitions",
      "get_event_definition",
      "create_event_definition",
      "update_event_definition",
      "delete_event_definition",
      "get_contact_events",
    ]);
    for (const t of tools.values()) expect(t.title).toBeTruthy();
    expect(tool!.risk).toBe("write");
    expect(tools.get("delete_event_definition")!.risk).toBe("destructive");
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

describe("MCP event definition tools", () => {
  it("scopes definitions to the team and maps conflicts", async () => {
    queries.listEventDefinitions.mockResolvedValue([]);
    await expect(callTool("list_event_definitions", {})).resolves.toEqual({
      items: [],
    });
    expect(queries.listEventDefinitions).toHaveBeenCalledWith("team-1");

    queries.getEventDefinition.mockResolvedValue(null);
    await expect(
      callTool("get_event_definition", { name: "nope" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    queries.createEventDefinition.mockRejectedValue(
      new FakeEventsError("event_definition_exists"),
    );
    await expect(
      callTool("create_event_definition", { name: "x" }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "event_definition_exists" } },
    });

    queries.deleteEventDefinition.mockRejectedValue(
      new FakeEventsError("event_definition_in_use"),
    );
    await expect(
      callTool("delete_event_definition", { name: "x", confirm: true }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "event_definition_in_use" } },
    });

    queries.updateEventDefinition.mockResolvedValue(null);
    await expect(
      callTool("update_event_definition", { name: "x", description: "d" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(queries.updateEventDefinition).toHaveBeenCalledWith("team-1", "x", {
      description: "d",
    });
  });

  it("only lists events of a contact in the team", async () => {
    getContactByContactId.mockResolvedValue({ id: "c-1", teamId: "team-2" });
    await expect(
      callTool("get_contact_events", { contactId: "cnt_1" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(queries.listContactEvents).not.toHaveBeenCalled();

    getContactByContactId.mockResolvedValue({ id: "c-1", teamId: "team-1" });
    queries.listContactEvents.mockResolvedValue({ items: [], total: 0 });
    await expect(
      callTool("get_contact_events", { contactId: "cnt_1", limit: 5 }),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(queries.listContactEvents).toHaveBeenCalledWith("c-1", {
      page: undefined,
      limit: 5,
      name: undefined,
    });
  });

  it("needs contacts:write to change definitions over OAuth", async () => {
    await expect(
      callTool(
        "create_event_definition",
        { name: "x" },
        { ...context, authKind: "oauth", scopes: ["contacts:read"] },
      ),
    ).resolves.toMatchObject({
      error: { code: "forbidden", safeDetails: { reason: "insufficient_scope" } },
    });
    expect(queries.createEventDefinition).not.toHaveBeenCalled();
  });
});
