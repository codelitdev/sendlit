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
  deleteMailFromSequence: vi.fn(),
  deleteSequence: vi.fn(),
  getSequenceDeletionImpact: vi.fn(),
  getSequenceSchedule: vi.fn(),
  getSubscribers: vi.fn(),
  getWaitingContacts: vi.fn(),
  setBroadcastArchived: vi.fn(),
  sendSequenceEmailTest: vi.fn(),
  publishEmailChanges: vi.fn(),
  discardEmailChanges: vi.fn(),
  listEmailVersions: vi.fn(),
  restoreEmailVersion: vi.fn(),
};

class InvalidCursorError extends Error {}

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
  deleteMailFromSequence: mocks.deleteMailFromSequence,
  deleteSequence: mocks.deleteSequence,
  getSequenceDeletionImpact: mocks.getSequenceDeletionImpact,
  getSequenceSchedule: mocks.getSequenceSchedule,
  getSubscribers: mocks.getSubscribers,
  getWaitingContacts: mocks.getWaitingContacts,
  setBroadcastArchived: mocks.setBroadcastArchived,
  InvalidCursorError,
}));
mock.module("../../sequences/publish", () => ({
  publishEmailChanges: mocks.publishEmailChanges,
  discardEmailChanges: mocks.discardEmailChanges,
  listEmailVersions: mocks.listEmailVersions,
  restoreEmailVersion: mocks.restoreEmailVersion,
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
  it("has one titled tool per sequence operation, in a stable order", () => {
    expect([...tools.keys()]).toEqual([
      "list_sequences",
      "get_sequence",
      "create_sequence",
      "update_sequence",
      "add_sequence_email",
      "update_sequence_email",
      "publish_sequence_changes",
      "discard_sequence_changes",
      "list_sequence_email_versions",
      "restore_sequence_email_version",
      "send_sequence_email_test",
      "delete_sequence_email",
      "preview_sequence_deletion",
      "delete_sequence",
      "archive_broadcast",
      "unarchive_broadcast",
      "start_sequence",
      "pause_sequence",
      "get_sequence_stats",
      "get_sequence_schedule",
      "list_sequence_email_waiting_contacts",
      "get_sequence_subscribers",
    ]);
    for (const tool of tools.values()) expect(tool.title).toBeTruthy();
    // Destructive tools advertise `confirm`, which the kit requires.
    for (const name of [
      "delete_sequence",
      "delete_sequence_email",
      "discard_sequence_changes",
    ]) {
      const tool = tools.get(name)!;
      expect(tool.risk).toBe("destructive");
      expect((tool.inputSchema as any).shape.confirm).toBeDefined();
    }
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
      items: [
        {
          sequenceId: "seq-1",
          emails: [{ emailId: "e1", draft: null, hasUnpublishedChanges: false }],
          hasUnpublishedChanges: false,
        },
      ],
      total: 1,
    });
    expect(mocks.listSequences).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", type: "sequence" }),
    );
    expect(mocks.countSequences).toHaveBeenCalledWith("team-1", "sequence", undefined);
  });

  it("returns an email's draft separately from the published version", async () => {
    mocks.getSequenceBySequenceId.mockResolvedValue({
      sequenceId: "seq-1",
      emails: [
        {
          emailId: "e1",
          subject: "Live",
          content: { content: [] },
          draftSubject: "Edited",
          draftContent: { content: [{ blockType: "text" }] },
          draftUpdatedAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    });
    const result: any = await call("get_sequence", { sequenceId: "seq-1" });
    expect(result.hasUnpublishedChanges).toBe(true);
    expect(result.emails[0]).toMatchObject({
      subject: "Live",
      draft: { subject: "Edited", content: { content: [{ blockType: "text" }] } },
      hasUnpublishedChanges: true,
    });
    expect(result.emails[0].draftSubject).toBeUndefined();
  });

  it("publishes changes only through publish_sequence_changes", async () => {
    mocks.publishEmailChanges.mockResolvedValue({ sequenceId: "seq-1", emails: [] });
    await expect(
      call("publish_sequence_changes", {
        sequenceId: "seq-1",
        emailIds: ["e1"],
        scope: "new_entrants",
      }),
    ).resolves.toMatchObject({ sequenceId: "seq-1", hasUnpublishedChanges: false });
    expect(mocks.publishEmailChanges).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq-1",
      emailIds: ["e1"],
      scope: "new_entrants",
    });

    mocks.publishEmailChanges.mockRejectedValue(new Error("mail_already_sent"));
    await expect(
      call("publish_sequence_changes", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({
      error: { code: "conflict", safeDetails: { reason: "mail_already_sent" } },
    });
  });

  it("lists and restores published versions", async () => {
    mocks.listEmailVersions.mockResolvedValue([
      {
        versionId: "ver_1",
        subject: "Live",
        content: { content: [] },
        publishedAt: new Date("2026-11-01T00:00:00Z"),
        live: true,
      },
    ]);
    await expect(
      call("list_sequence_email_versions", { sequenceId: "seq-1", emailId: "e1" }),
    ).resolves.toEqual({
      items: [
        {
          versionId: "ver_1",
          subject: "Live",
          content: { content: [] },
          publishedAt: "2026-11-01T00:00:00.000Z",
          live: true,
        },
      ],
    });

    mocks.restoreEmailVersion.mockRejectedValue(new Error("version_not_found"));
    await expect(
      call("restore_sequence_email_version", {
        sequenceId: "seq-1",
        emailId: "e1",
        versionId: "ver_x",
      }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
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

describe("MCP sequence deletion and archive tools", () => {
  it("explains why an active sequence or a sent broadcast can't be deleted", async () => {
    mocks.deleteSequence.mockRejectedValueOnce(new Error("sequence_active"));
    const active: any = await call("delete_sequence", { sequenceId: "seq-1" });
    expect(active.error).toMatchObject({
      code: "conflict",
      safeDetails: { reason: "sequence_active" },
    });
    expect(active.error.safeDetails.message).toContain("Pause it before deleting it");

    mocks.deleteSequence.mockRejectedValueOnce(new Error("broadcast_sent"));
    const sent: any = await call("delete_sequence", { sequenceId: "seq-1" });
    expect(sent.error.safeDetails).toMatchObject({ reason: "broadcast_sent" });
    expect(sent.error.safeDetails.message).toContain("Archive it instead");
  });

  it("deletes a sequence of the caller's team", async () => {
    mocks.deleteSequence.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(call("delete_sequence", { sequenceId: "seq-1" })).resolves.toEqual({
      message: "Sequence deleted.",
    });
    expect(mocks.deleteSequence).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq-1",
    });
    await expect(
      call("delete_sequence", { sequenceId: "seq-2" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("deletes one email and maps its failures", async () => {
    mocks.deleteMailFromSequence.mockResolvedValueOnce({
      sequenceId: "seq-1",
      emails: [],
    });
    await expect(
      call("delete_sequence_email", { sequenceId: "seq-1", emailId: "email_1" }),
    ).resolves.toMatchObject({ sequenceId: "seq-1" });
    expect(mocks.deleteMailFromSequence).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq-1",
      emailId: "email_1",
    });
    mocks.deleteMailFromSequence.mockResolvedValueOnce(null);
    await expect(
      call("delete_sequence_email", { sequenceId: "seq-1", emailId: "email_x" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("archives and restores a broadcast of the caller's team", async () => {
    const archivedAt = new Date("2026-10-29T00:00:00Z");
    mocks.setBroadcastArchived
      .mockResolvedValueOnce({ sequenceId: "seq-1", archivedAt, emails: [] })
      .mockResolvedValueOnce({ sequenceId: "seq-1", archivedAt: null, emails: [] })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("broadcast_not_sent"));

    await expect(
      call("archive_broadcast", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({ archivedAt: archivedAt.toISOString() });
    expect(mocks.setBroadcastArchived).toHaveBeenLastCalledWith({
      teamId: "team-1",
      sequenceId: "seq-1",
      archived: true,
    });
    await expect(
      call("unarchive_broadcast", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({ archivedAt: null });
    expect(mocks.setBroadcastArchived).toHaveBeenLastCalledWith({
      teamId: "team-1",
      sequenceId: "seq-1",
      archived: false,
    });
    await expect(
      call("archive_broadcast", { sequenceId: "seq-2" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    const draft: any = await call("archive_broadcast", { sequenceId: "seq-3" });
    expect(draft.error).toMatchObject({
      code: "conflict",
      safeDetails: { reason: "broadcast_not_sent" },
    });
    expect(draft.error.safeDetails.message).toContain(
      "Only a sent broadcast can be archived",
    );
  });

  it("previews a sequence deletion", async () => {
    const preview = {
      status: "paused",
      blocker: null,
      enrolledCount: 2,
      emailsSentCount: 5,
    };
    mocks.getSequenceDeletionImpact.mockResolvedValueOnce(preview);
    await expect(
      call("preview_sequence_deletion", { sequenceId: "seq-1" }),
    ).resolves.toEqual(preview);
    expect(mocks.getSequenceDeletionImpact).toHaveBeenCalledWith("team-1", "seq-1");
  });

  it("refuses a delete to an OAuth token without sequences:write", async () => {
    await expect(
      call(
        "delete_sequence",
        { sequenceId: "seq-1" },
        { ...oauth, scopes: ["sequences:read"] },
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "sequences:write" },
      },
    });
    expect(mocks.deleteSequence).not.toHaveBeenCalled();
  });
});

describe("MCP sequence schedule tools", () => {
  it("checks sequence ownership before returning the schedule", async () => {
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);
    await expect(
      call("get_sequence_schedule", { sequenceId: "seq-1" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.getSequenceSchedule).not.toHaveBeenCalled();

    const sequence = { sequenceId: "seq-1" };
    const schedule = {
      waiting: 3,
      emails: [{ emailId: "email_1", waiting: 3, nextSendAt: 1_800_000_000_000 }],
    };
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    mocks.getSequenceSchedule.mockResolvedValueOnce(schedule);
    await expect(
      call("get_sequence_schedule", { sequenceId: "seq-1" }),
    ).resolves.toEqual(schedule);
    expect(mocks.getSequenceSchedule).toHaveBeenCalledWith(sequence);
  });

  it("lists waiting contacts only for an email of the caller's sequence", async () => {
    const sequence = { sequenceId: "seq-1", emailsOrder: ["email_1"] };
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);
    await expect(
      call("list_sequence_email_waiting_contacts", {
        sequenceId: "seq-1",
        emailId: "email_1",
      }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    await expect(
      call("list_sequence_email_waiting_contacts", {
        sequenceId: "seq-1",
        emailId: "email_other",
      }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.getWaitingContacts).not.toHaveBeenCalled();

    const page = {
      items: [
        { contactId: "cnt_1", email: "a@example.com", name: null, nextSendAt: 1_000 },
      ],
      total: 1,
      nextCursor: null,
    };
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    mocks.getWaitingContacts.mockResolvedValueOnce(page);
    await expect(
      call("list_sequence_email_waiting_contacts", {
        sequenceId: "seq-1",
        emailId: "email_1",
        after: "c1",
        q: "ana",
      }),
    ).resolves.toEqual(page);
    expect(mocks.getWaitingContacts).toHaveBeenCalledWith(sequence, "email_1", {
      after: "c1",
      limit: undefined,
      q: "ana",
    });

    mocks.getSequenceBySequenceId.mockResolvedValueOnce(sequence);
    mocks.getWaitingContacts.mockRejectedValueOnce(new InvalidCursorError("bad"));
    await expect(
      call("list_sequence_email_waiting_contacts", {
        sequenceId: "seq-1",
        emailId: "email_1",
        after: "garbage",
      }),
    ).resolves.toMatchObject({
      error: { code: "validation_failed", safeDetails: { reason: "invalid_cursor" } },
    });
  });

  it("pages the contacts a sequence has sent to", async () => {
    mocks.getSequenceBySequenceId.mockResolvedValueOnce({ sequenceId: "seq-1" });
    mocks.getSubscribers.mockResolvedValueOnce(["cnt_1", "cnt_2"]);
    mocks.getSubscribersCount.mockResolvedValueOnce(7);
    await expect(
      call("get_sequence_subscribers", { sequenceId: "seq-1", page: 2, limit: 2 }),
    ).resolves.toEqual({ items: ["cnt_1", "cnt_2"], total: 7 });
    expect(mocks.getSubscribers).toHaveBeenCalledWith({
      sequenceId: "seq-1",
      page: 2,
      limit: 2,
    });
    mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);
    await expect(
      call("get_sequence_subscribers", { sequenceId: "seq-x" }),
    ).resolves.toMatchObject({ error: { code: "not_found" } });
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
