import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  getEspConfigByEspId: vi.fn(),
  listEspConfigs: vi.fn(),
  listDeliveryEvents: vi.fn(),
  countDeliveryEvents: vi.fn(),
  getOutboundMessagesByIds: vi.fn(),
};

mock.module("../../settings/esp/queries", () => ({
  getEspConfigByEspId: mocks.getEspConfigByEspId,
  listEspConfigs: mocks.listEspConfigs,
}));
mock.module("../../delivery-feedback/delivery-event-queries", () => ({
  listDeliveryEvents: mocks.listDeliveryEvents,
  countDeliveryEvents: mocks.countDeliveryEvents,
}));
mock.module("../../delivery-feedback/outbound-queries", () => ({
  getOutboundMessagesByIds: mocks.getOutboundMessagesByIds,
}));

const { deliveryEventTools } = await import("./delivery-feedback");

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
const [tool] = deliveryEventTools();
function call(args: unknown): Promise<any> {
  return tool!.handler({ context, args, signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listEspConfigs.mockResolvedValue([{ id: "esp-internal", espId: "esp_1" }]);
  mocks.getOutboundMessagesByIds.mockResolvedValue(new Map());
});

describe("MCP list_delivery_events", () => {
  it("is the only dedicated delivery-feedback tool", () => {
    expect(deliveryEventTools().map((t) => t.name)).toEqual(["list_delivery_events"]);
    expect(tool!.risk).toBe("read");
  });

  it("lists the team's events with the ESP and message of each", async () => {
    const occurredAt = new Date("2026-10-01T00:00:00.000Z");
    mocks.listDeliveryEvents.mockResolvedValue([
      {
        eventId: "dev_1",
        provider: "ses",
        outboundMessageId: "out-1",
        recipientEmail: "a@example.com",
        eventType: "hard_bounce",
        bounceClass: "permanent",
        reason: "mailbox missing",
        occurredAt,
        receivedAt: occurredAt,
      },
    ]);
    mocks.countDeliveryEvents.mockResolvedValue(1);
    mocks.getOutboundMessagesByIds.mockResolvedValue(
      new Map([
        [
          "out-1",
          {
            deliverySourceType: "team",
            espConfigId: "esp-internal",
            messageId: "<m@x>",
          },
        ],
      ]),
    );

    const result = await call({
      eventType: "hard_bounce",
      offset: 2,
      itemsPerPage: 10,
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          eventId: "dev_1",
          espId: "esp_1",
          deliverySourceType: "team",
          messageId: "<m@x>",
          occurredAt: "2026-10-01T00:00:00.000Z",
        }),
      ],
      total: 1,
    });
    expect(mocks.listDeliveryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        eventType: "hard_bounce",
        offset: 2,
        rowsPerPage: 10,
      }),
    );
    expect(mocks.countDeliveryEvents).toHaveBeenCalledWith(
      expect.not.objectContaining({ offset: 2 }),
    );
  });

  it("filters by an ESP of the team, and returns nothing for an unknown one", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue(null);
    await expect(call({ espId: "esp_other" })).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(mocks.getEspConfigByEspId).toHaveBeenCalledWith("team-1", "esp_other");
    expect(mocks.listDeliveryEvents).not.toHaveBeenCalled();

    mocks.getEspConfigByEspId.mockResolvedValue({ id: "esp-internal" });
    mocks.listDeliveryEvents.mockResolvedValue([]);
    mocks.countDeliveryEvents.mockResolvedValue(0);
    await call({ espId: "esp_1" });
    expect(mocks.listDeliveryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ espConfigId: "esp-internal" }),
    );
  });
});
