import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  getEspConfigByEspId: vi.fn(),
  listEspConfigs: vi.fn(),
  getFeedbackConnectionForTeamEsp: vi.fn(),
  upsertFeedbackConnection: vi.fn(),
  feedbackConnectionReadinessError: vi.fn(),
  recordFeedbackConnectionVerified: vi.fn(),
  disableFeedbackConnection: vi.fn(),
  listDeliveryEvents: vi.fn(),
  countDeliveryEvents: vi.fn(),
  getDeliveryEventByEventId: vi.fn(),
  getOutboundMessagesByIds: vi.fn(),
  addOrStrengthenSuppression: vi.fn(),
  listSuppressions: vi.fn(),
  countSuppressions: vi.fn(),
  getSuppressionBySuppressionId: vi.fn(),
  releaseSuppression: vi.fn(),
};

mock.module("../../settings/esp/queries", () => ({
  checkAndRememberDomainAuthentication: vi.fn(),
  getEspConfigByEspId: mocks.getEspConfigByEspId,
  listEspConfigs: mocks.listEspConfigs,
}));
mock.module("../../delivery-feedback/feedback-connection-queries", () => ({
  getFeedbackConnectionForTeamEsp: mocks.getFeedbackConnectionForTeamEsp,
  upsertFeedbackConnection: mocks.upsertFeedbackConnection,
  feedbackConnectionReadinessError: mocks.feedbackConnectionReadinessError,
  recordFeedbackConnectionVerified: mocks.recordFeedbackConnectionVerified,
  disableFeedbackConnection: mocks.disableFeedbackConnection,
}));
mock.module("../../delivery-feedback/delivery-event-queries", () => ({
  listDeliveryEvents: mocks.listDeliveryEvents,
  countDeliveryEvents: mocks.countDeliveryEvents,
  getDeliveryEventByEventId: mocks.getDeliveryEventByEventId,
}));
mock.module("../../delivery-feedback/outbound-queries", () => ({
  getOutboundMessagesByIds: mocks.getOutboundMessagesByIds,
}));
mock.module("../../delivery-feedback/suppression-queries", () => ({
  addOrStrengthenSuppression: mocks.addOrStrengthenSuppression,
  listSuppressions: mocks.listSuppressions,
  countSuppressions: mocks.countSuppressions,
  getSuppressionBySuppressionId: mocks.getSuppressionBySuppressionId,
  releaseSuppression: mocks.releaseSuppression,
}));

const { deliveryFeedbackTools } = await import("./delivery-feedback");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
};
const oauth = {
  ...context,
  authKind: "oauth" as const,
  user: { id: "user-1" } as any,
  scopes: [
    "feedback:read",
    "feedback:write",
    "suppressions:read",
    "suppressions:write",
  ],
};
const tools = new Map(deliveryFeedbackTools().map((tool) => [tool.name, tool]));
function call(name: string, args: unknown, ctx: any = context): Promise<any> {
  return tools.get(name)!.handler({ context: ctx, args, signal }) as Promise<any>;
}
const callList = (args: unknown) => call("list_delivery_events", args);

const suppressionRow = (overrides: Record<string, unknown> = {}) => ({
  suppressionId: "sup_1",
  recipientEmail: "ada@example.com",
  reason: "hard_bounce",
  active: true,
  firstSuppressedAt: new Date("2026-10-01T00:00:00.000Z"),
  lastSuppressedAt: new Date("2026-10-01T00:00:00.000Z"),
  releasedAt: null,
  releaseReason: null,
  ...overrides,
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listEspConfigs.mockResolvedValue([{ id: "esp-internal", espId: "esp_1" }]);
  mocks.getOutboundMessagesByIds.mockResolvedValue(new Map());
});

describe("MCP delivery-feedback tools", () => {
  it("serves every feedback, delivery-event and suppression tool, each with a title", () => {
    expect([...tools.keys()]).toEqual([
      "get_feedback_requirement",
      "get_esp_feedback_connection",
      "upsert_esp_feedback_connection",
      "test_esp_feedback_connection",
      "delete_esp_feedback_connection",
      "list_delivery_events",
      "get_delivery_event",
      "list_suppressions",
      "get_suppression",
      "release_suppression",
      "add_suppression",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    const remove = tools.get("delete_esp_feedback_connection")!;
    expect(remove.risk).toBe("destructive");
    expect((remove.inputSchema as any).shape.confirm).toBeDefined();
  });

  it("needs the suppressions:write scope over OAuth", async () => {
    await expect(
      call(
        "add_suppression",
        { email: "a@example.com" },
        { ...oauth, scopes: ["suppressions:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: {
          reason: "insufficient_scope",
          requiredScope: "suppressions:write",
        },
      },
    });
    expect(mocks.addOrStrengthenSuppression).not.toHaveBeenCalled();
  });

  it("rejects configuring feedback for a provider without a reviewed adapter", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({
      id: "esp-internal-1",
      espId: "esp_1",
      provider: "smtp",
    });
    await expect(
      call("upsert_esp_feedback_connection", { espId: "esp_1", credential: "secret" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "feedback_provider_unsupported" },
      },
    });
    expect(mocks.upsertFeedbackConnection).not.toHaveBeenCalled();
  });

  it("requires an SNS topic ARN instead of a credential for SES", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({
      id: "esp-internal-1",
      espId: "esp_1",
      provider: "ses",
    });
    const missing = await call("upsert_esp_feedback_connection", {
      espId: "esp_1",
      credential: "secret",
    });
    expect(missing.error).toMatchObject({
      code: "validation_failed",
      safeDetails: { reason: "invalid_feedback_connection" },
    });
    expect(mocks.upsertFeedbackConnection).not.toHaveBeenCalled();

    mocks.upsertFeedbackConnection.mockResolvedValue({
      id: "conn-1",
      connectionId: "whc_ses",
      provider: "ses",
      encryptedCredentials: null,
      expectedTopicArn: "arn:aws:sns:us-east-1:123456789012:feedback",
      subscriptionConfirmedAt: null,
      status: "pending",
      lastReceivedAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    });
    const created = await call("upsert_esp_feedback_connection", {
      espId: "esp_1",
      expectedTopicArn: "arn:aws:sns:us-east-1:123456789012:feedback",
    });
    expect(created.error).toBeUndefined();
    expect(mocks.upsertFeedbackConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ses",
        expectedTopicArn: "arn:aws:sns:us-east-1:123456789012:feedback",
      }),
    );
  });

  it("upserts a feedback connection for a capable provider", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({
      id: "esp-internal-1",
      espId: "esp_1",
      provider: "postmark",
    });
    mocks.upsertFeedbackConnection.mockResolvedValue({
      id: "conn-1",
      connectionId: "whc_abc",
      provider: "postmark",
      encryptedCredentials: "enc",
      status: "pending",
      lastReceivedAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    });
    const result = await call("upsert_esp_feedback_connection", {
      espId: "esp_1",
      credential: "top-secret",
    });
    expect(mocks.upsertFeedbackConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        espConfigId: "esp-internal-1",
        provider: "postmark",
        credential: "top-secret",
      }),
    );
    expect(result).toMatchObject({
      connectionId: "whc_abc",
      espId: "esp_1",
      hasCredential: true,
    });
  });

  it("returns not_found for an unknown ESP or connection", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue(null);
    for (const name of [
      "get_esp_feedback_connection",
      "test_esp_feedback_connection",
      "delete_esp_feedback_connection",
    ]) {
      await expect(call(name, { espId: "esp_missing" })).resolves.toMatchObject({
        error: { code: "not_found" },
      });
    }

    mocks.getEspConfigByEspId.mockResolvedValue({
      id: "esp-internal-1",
      espId: "esp_1",
    });
    mocks.disableFeedbackConnection.mockResolvedValue(false);
    await expect(
      call("delete_esp_feedback_connection", { espId: "esp_1", confirm: true }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    mocks.disableFeedbackConnection.mockResolvedValue(true);
    await expect(
      call("delete_esp_feedback_connection", { espId: "esp_1", confirm: true }),
    ).resolves.toEqual({ message: "Feedback connection disabled." });
  });

  it("reports whether a connection is armed", async () => {
    mocks.getEspConfigByEspId.mockResolvedValue({
      id: "esp-internal-1",
      espId: "esp_1",
    });
    mocks.getFeedbackConnectionForTeamEsp.mockResolvedValue(null);
    await expect(
      call("test_esp_feedback_connection", { espId: "esp_1" }),
    ).resolves.toEqual({
      success: false,
      error: "feedback_not_configured",
    });

    mocks.getFeedbackConnectionForTeamEsp.mockResolvedValue({ id: "conn-1" });
    mocks.feedbackConnectionReadinessError.mockReturnValue(null);
    await expect(
      call("test_esp_feedback_connection", { espId: "esp_1" }),
    ).resolves.toEqual({
      success: true,
    });
    expect(mocks.recordFeedbackConnectionVerified).toHaveBeenCalledWith("conn-1");
  });

  it("returns a delivery event of the team, or not_found", async () => {
    mocks.getDeliveryEventByEventId.mockResolvedValue(null);
    await expect(
      call("get_delivery_event", { eventId: "dev_x" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.getDeliveryEventByEventId).toHaveBeenCalledWith("team-1", "dev_x");
  });

  it("blocks a workspace user from releasing a complaint suppression", async () => {
    mocks.releaseSuppression.mockRejectedValue(new Error("suppression_not_releasable"));
    const result = await call("release_suppression", { suppressionId: "sup_1" }, oauth);
    expect(mocks.releaseSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        suppressionId: "sup_1",
        actorType: "workspace_user",
        actorUserId: "user-1",
      }),
    );
    expect(result.error).toMatchObject({
      code: "forbidden",
      safeDetails: { reason: "suppression_not_releasable" },
    });

    mocks.releaseSuppression.mockRejectedValue(new Error("suppression_not_found"));
    await expect(
      call("release_suppression", { suppressionId: "sup_9" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    mocks.releaseSuppression.mockRejectedValue(new Error("db down"));
    await expect(
      call("release_suppression", { suppressionId: "sup_9" }),
    ).rejects.toThrow("db down");
  });

  it("releases an eligible suppression", async () => {
    mocks.releaseSuppression.mockResolvedValue(
      suppressionRow({
        active: false,
        releasedAt: new Date(),
        releaseReason: "mailbox fixed",
      }),
    );
    const result = await call("release_suppression", {
      suppressionId: "sup_1",
      explanation: "mailbox fixed",
    });
    expect(result).toMatchObject({ suppressionId: "sup_1", active: false });
    expect(mocks.releaseSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null }),
    );
  });

  it("lists, gets and adds suppressions for the team", async () => {
    mocks.listSuppressions.mockResolvedValue([suppressionRow()]);
    mocks.countSuppressions.mockResolvedValue(1);
    const list = await call("list_suppressions", { active: true });
    expect(mocks.listSuppressions).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", active: true }),
    );
    expect(list).toMatchObject({ total: 1, items: [{ suppressionId: "sup_1" }] });
    expect(list.items[0].firstSuppressedAt).toBe("2026-10-01T00:00:00.000Z");

    mocks.getSuppressionBySuppressionId.mockResolvedValue(null);
    await expect(
      call("get_suppression", { suppressionId: "sup_x" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    mocks.addOrStrengthenSuppression.mockResolvedValue(
      suppressionRow({ reason: "manual" }),
    );
    await expect(
      call(
        "add_suppression",
        { email: "ada@example.com", note: "role account" },
        oauth,
      ),
    ).resolves.toMatchObject({ reason: "manual" });
    expect(mocks.addOrStrengthenSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        recipientEmail: "ada@example.com",
        reason: "manual",
        actorUserId: "user-1",
        explanation: "role account",
      }),
    );
  });
});

describe("MCP list_delivery_events", () => {
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

    const result = await callList({
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
    await expect(callList({ espId: "esp_other" })).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(mocks.getEspConfigByEspId).toHaveBeenCalledWith("team-1", "esp_other");
    expect(mocks.listDeliveryEvents).not.toHaveBeenCalled();

    mocks.getEspConfigByEspId.mockResolvedValue({ id: "esp-internal" });
    mocks.listDeliveryEvents.mockResolvedValue([]);
    mocks.countDeliveryEvents.mockResolvedValue(0);
    await callList({ espId: "esp_1" });
    expect(mocks.listDeliveryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ espConfigId: "esp-internal" }),
    );
  });
});
