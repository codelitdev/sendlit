import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const mocks = {
  addMailToSequence: vi.fn(),
  countSequences: vi.fn(),
  createSequence: vi.fn(),
  getEmailSentCount: vi.fn(),
  getSequenceBySequenceId: vi.fn(),
  getSequenceClickThroughRate: vi.fn(),
  getSequenceOpenRate: vi.fn(),
  getSubscribersCount: vi.fn(),
  listSequences: vi.fn(),
  pauseSequence: vi.fn(),
  startSequence: vi.fn(),
  updateMailInSequence: vi.fn(),
  updateSequence: vi.fn(),
  sendSequenceEmailTest: vi.fn(),
};

mock.module("../../sequences/queries", () => ({
  addMailToSequence: mocks.addMailToSequence,
  countSequences: mocks.countSequences,
  createSequence: mocks.createSequence,
  getEmailSentCount: mocks.getEmailSentCount,
  getSequenceBySequenceId: mocks.getSequenceBySequenceId,
  getSequenceClickThroughRate: mocks.getSequenceClickThroughRate,
  getSequenceOpenRate: mocks.getSequenceOpenRate,
  getSubscribersCount: mocks.getSubscribersCount,
  listSequences: mocks.listSequences,
  pauseSequence: mocks.pauseSequence,
  startSequence: mocks.startSequence,
  updateMailInSequence: mocks.updateMailInSequence,
  updateSequence: mocks.updateSequence,
}));
mock.module("../../sequences/test-send", () => ({
  sendSequenceEmailTest: mocks.sendSequenceEmailTest,
}));
mock.module("../../abuse/pacing-status", () => ({ broadcastPacing: async () => null }));
mock.module("../../automation/sending-health", () => ({
  sequenceDeliveryRates: async () => ({ bounceRate: 0, complaintRate: 0 }),
}));

const { sequenceTools } = await import("./sequences");
const { sequenceSchema } = await import("./schemas");
const { PlanGateError } = await import("../../billing/errors");
const { responses } = await import("../../config/strings");

const teamKey = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};
const oauth = {
  ...teamKey,
  authKind: "oauth" as const,
  user: { id: "user-1", email: "owner@example.com", name: "Owner" } as any,
  scopes: ["sequences:read", "sequences:write"],
};

const tools = new Map(sequenceTools().map((tool) => [tool.name, tool]));

function call(name: string, args: Record<string, unknown>, context: any = teamKey) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler({ context, args, signal: new AbortController().signal });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe("MCP sequence tools", () => {
  it("keeps only the dedicated sequence tools", () => {
    expect([...tools.keys()]).toEqual([
      "list_sequences",
      "get_sequence",
      "create_sequence",
      "update_sequence",
      "add_sequence_email",
      "update_sequence_email",
      "send_sequence_email_test",
      "start_sequence",
      "pause_sequence",
      "get_sequence_stats",
    ]);
  });

  it("refuses an OAuth token without the sequences scope", async () => {
    await expect(
      call(
        "list_sequences",
        { type: "broadcast" },
        { ...oauth, scopes: ["contacts:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "sequences:read" },
      },
    });
    expect(mocks.listSequences).not.toHaveBeenCalled();
  });

  it("validates non-empty template IDs on sequence creation/add-email inputs", () => {
    expect(
      tools
        .get("create_sequence")!
        .inputSchema.safeParse({ type: "broadcast", templateId: "" }).success,
    ).toBe(false);
    expect(
      tools
        .get("add_sequence_email")!
        .inputSchema.safeParse({ sequenceId: "seq-1", templateId: "" }).success,
    ).toBe(false);
  });

  it("lists sequences of the resolved team", async () => {
    mocks.listSequences.mockResolvedValue([
      {
        sequenceId: "seq-1",
        outboxId: "internal",
        emails: [{ emailId: "e1", sequenceId: "x" }],
      },
    ]);
    mocks.countSequences.mockResolvedValue(1);
    await expect(call("list_sequences", { type: "sequence" })).resolves.toEqual({
      items: [{ sequenceId: "seq-1", emails: [{ emailId: "e1" }] }],
      total: 1,
    });
    expect(mocks.listSequences).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", type: "sequence" }),
    );
    expect(mocks.countSequences).toHaveBeenCalledWith("team-1", "sequence", undefined);
  });

  it("checks sequence ownership before returning stats", async () => {
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);
    await expect(
      call("get_sequence_stats", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.getSequenceBySequenceId).toHaveBeenCalledWith("team-1", "seq-1");
    expect(mocks.getEmailSentCount).not.toHaveBeenCalled();

    mocks.getSequenceBySequenceId.mockResolvedValueOnce({
      id: "s1",
      sequenceId: "seq-1",
    });
    mocks.getEmailSentCount.mockResolvedValue(5);
    mocks.getSequenceOpenRate.mockResolvedValue(0.4);
    mocks.getSequenceClickThroughRate.mockResolvedValue(0.2);
    mocks.getSubscribersCount.mockResolvedValue(3);
    await expect(call("get_sequence_stats", { sequenceId: "seq-1" })).resolves.toEqual({
      sent: 5,
      openRate: 0.4,
      clickThroughRate: 0.2,
      subscribersCount: 3,
      bounceRate: 0,
      complaintRate: 0,
    });
  });

  it("sends a sequence email test to the signed-in user by default", async () => {
    mocks.sendSequenceEmailTest.mockResolvedValue({
      sent: ["owner@example.com"],
      skipped: [],
      lastTestSentAt: "2026-10-19T00:00:00.000Z",
    });
    await expect(
      call(
        "send_sequence_email_test",
        { sequenceId: "seq_1", emailId: "email_1" },
        oauth,
      ),
    ).resolves.toMatchObject({ sent: ["owner@example.com"] });
    expect(mocks.sendSequenceEmailTest).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq_1",
      emailId: "email_1",
      to: undefined,
      fallbackRecipient: "owner@example.com",
    });

    // A team API key has no owner to fall back to.
    mocks.sendSequenceEmailTest.mockRejectedValueOnce(
      new Error("test_recipients_required"),
    );
    await expect(
      call("send_sequence_email_test", { sequenceId: "seq_1", emailId: "email_1" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "test_recipients_required" },
      },
    });
    expect(mocks.sendSequenceEmailTest).toHaveBeenLastCalledWith(
      expect.objectContaining({ fallbackRecipient: undefined }),
    );

    mocks.sendSequenceEmailTest.mockRejectedValueOnce(new Error("email_not_found"));
    await expect(
      call("send_sequence_email_test", { sequenceId: "seq_1", emailId: "email_x" }),
    ).resolves.toMatchObject({
      error: { code: "not_found", safeDetails: { reason: "email_not_found" } },
    });

    mocks.sendSequenceEmailTest.mockRejectedValueOnce(
      new Error("test_send_limit_reached"),
    );
    await expect(
      call("send_sequence_email_test", { sequenceId: "seq_1", emailId: "email_1" }),
    ).resolves.toMatchObject({
      error: {
        code: "rate_limited",
        safeDetails: { reason: "test_send_limit_reached" },
      },
    });
  });

  it("maps start failures to platform codes with the REST reason", async () => {
    mocks.startSequence.mockRejectedValueOnce(new Error("mailing_address_required"));
    await expect(
      call("start_sequence", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: {
          reason: "mailing_address_required",
          message: "A mailing address is required for broadcasts and sequences.",
        },
      },
    });

    mocks.startSequence.mockRejectedValueOnce(
      new Error(responses.sequence_already_started),
    );
    await expect(
      call("start_sequence", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({
      error: {
        code: "conflict",
        safeDetails: {
          reason: "sequence_already_started",
          message: responses.sequence_already_started,
        },
      },
    });

    mocks.startSequence.mockRejectedValueOnce(
      new Error(`${responses.sequence_details_missing}: trigger`),
    );
    await expect(
      call("start_sequence", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });

    mocks.startSequence.mockRejectedValueOnce(
      new PlanGateError("plan_limit_reached" as any, { limit: 3, nested: { a: 1 } }),
    );
    const gated: any = await call("start_sequence", { sequenceId: "seq-1" });
    expect(gated.error.code).toBe("forbidden");
    expect(gated.error.safeDetails).toMatchObject({
      reason: "plan_limit_reached",
      limit: 3,
    });
    expect(gated.error.safeDetails).not.toHaveProperty("nested");
  });

  it("rethrows errors that are not a known code", async () => {
    mocks.createSequence.mockRejectedValueOnce(
      new Error("Connection terminated unexpectedly"),
    );
    await expect(
      call("create_sequence", { type: "broadcast", templateId: "tpl_1" }),
    ).rejects.toThrow("Connection terminated unexpectedly");

    mocks.createSequence.mockRejectedValueOnce(new Error("template_not_marketing"));
    await expect(
      call("create_sequence", { type: "broadcast", templateId: "tpl_1" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: { reason: "template_not_marketing" },
      },
    });
  });

  it("returns not_found when updating another team's sequence", async () => {
    mocks.updateSequence.mockResolvedValueOnce(null);
    await expect(
      call("update_sequence", { sequenceId: "seq-x", title: "New" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.updateSequence).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq-x",
      title: "New",
    });
  });
});

describe("MCP sequence output schema", () => {
  it("accepts what the sequence tools return", () => {
    // Regression: the schema required an `espId` the tools never return,
    // so every sequence tool failed MCP output validation.
    const parsed = sequenceSchema.safeParse({
      sequenceId: "seq_1",
      type: "sequence",
      title: "Follow-up",
      status: "active",
      triggerType: "event:custom",
      triggerData: "course purchased",
      triggerFilter: { aggregator: "and", filters: [] },
      reentry: "once",
      reentryPeriodDays: null,
      filter: null,
      excludeFilter: null,
      emailsOrder: ["email_1"],
      entrants: [],
      report: {},
      viewInBrowser: false,
      webPublished: false,
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
      emails: [
        {
          emailId: "email_1",
          subject: "Hi",
          content: { style: {}, meta: {}, content: [] },
          delayInMillis: 0,
          published: true,
          contentScanVerdict: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
