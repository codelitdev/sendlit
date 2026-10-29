import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const mocks = {
  createSequence: vi.fn(),
  addMailToSequence: vi.fn(),
  updateMailInSequence: vi.fn(),
  sendSequenceEmailTest: vi.fn(),
  deleteSequence: vi.fn(),
  getSequenceDeletionImpact: vi.fn(),
  setBroadcastArchived: vi.fn(),
  listSequences: vi.fn(),
  countSequences: vi.fn(),
};

mock.module("../auth/middleware", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
mock.module("../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = "team-1";
    req.user = { email: "owner@example.com" };
    next();
  },
}));
mock.module("../abuse/pacing-status", () => ({ broadcastPacing: async () => null }));
mock.module("../automation/sending-health", () => ({
  sequenceDeliveryRates: async () => ({ bounceRate: 0, complaintRate: 0 }),
}));
mock.module("../web/queries", () => ({
  toWebPublishing: mock(),
  updateWebPublishing: mock(),
  WebPublishingError: class extends Error {},
}));
mock.module("./test-send", () => ({
  sendSequenceEmailTest: mocks.sendSequenceEmailTest,
}));
mock.module("./queries", () => ({
  createSequence: mocks.createSequence,
  addMailToSequence: mocks.addMailToSequence,
  countSequences: mocks.countSequences,
  deleteSequence: mocks.deleteSequence,
  setBroadcastArchived: mocks.setBroadcastArchived,
  getSequenceDeletionImpact: mocks.getSequenceDeletionImpact,
  deleteMailFromSequence: vi.fn(),
  getEmailSentCount: vi.fn(),
  getSequenceBySequenceId: vi.fn(),
  getSequenceClickThroughRate: vi.fn(),
  getSequenceOpenRate: vi.fn(),
  getSubscribers: vi.fn(),
  getSubscribersCount: vi.fn(),
  listSequences: mocks.listSequences,
  pauseSequence: vi.fn(),
  startSequence: vi.fn(),
  updateMailInSequence: mocks.updateMailInSequence,
  updateSequence: vi.fn(),
}));

const { requestApp } = await import("../test/http");
const { default: sequenceRoutes } = await import("./routes");

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(sequenceRoutes);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("marketing template route boundary", () => {
  it("rejects a transactional template during sequence creation", async () => {
    mocks.createSequence.mockRejectedValue(new Error("template_not_marketing"));

    const response = await requestApp(app(), "/sequences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "sequence",
        templateId: "tpl_transactional",
      }),
    });

    expect(response.status).toBe(422);
    expect(response.json<unknown>()).toEqual({ error: "template_not_marketing" });
  });

  it("rejects a transactional template when adding a sequence email", async () => {
    mocks.addMailToSequence.mockRejectedValue(new Error("template_not_marketing"));

    const response = await requestApp(app(), "/sequences/seq_1/emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "tpl_transactional" }),
    });

    expect(response.status).toBe(422);
    expect(response.json<unknown>()).toEqual({ error: "template_not_marketing" });
  });

  it("rejects a transactional template when changing a sequence email template", async () => {
    mocks.updateMailInSequence.mockRejectedValue(new Error("template_not_marketing"));

    const response = await requestApp(app(), "/sequences/seq_1/emails/eml_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "tpl_transactional" }),
    });

    expect(response.status).toBe(422);
    expect(response.json<unknown>()).toEqual({ error: "template_not_marketing" });
  });
});

describe("POST /sequences/:sequenceId/emails/:emailId/test", () => {
  const post = (body: unknown) =>
    requestApp(app(), "/sequences/seq_1/emails/email_1/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("falls back to the signed-in user's address", async () => {
    mocks.sendSequenceEmailTest.mockResolvedValue({
      sent: ["owner@example.com"],
      skipped: [],
      lastTestSentAt: "2026-10-19T00:00:00.000Z",
    });

    const response = await post({});

    expect(response.status).toBe(200);
    expect(mocks.sendSequenceEmailTest).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq_1",
      emailId: "email_1",
      to: undefined,
      fallbackRecipient: "owner@example.com",
    });
  });

  it("maps errors to 404, 429 and 400", async () => {
    mocks.sendSequenceEmailTest.mockRejectedValueOnce(new Error("email_not_found"));
    expect((await post({})).status).toBe(404);
    mocks.sendSequenceEmailTest.mockRejectedValueOnce(
      new Error("test_send_limit_reached"),
    );
    expect((await post({})).status).toBe(429);
    mocks.sendSequenceEmailTest.mockRejectedValueOnce(
      new Error("delivery_source_unavailable"),
    );
    expect((await post({})).status).toBe(400);
    expect(
      (
        await post({
          to: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"],
        })
      ).status,
    ).toBe(400);
  });
});

describe("sequence delete route", () => {
  it("answers 409 sequence_active for an active sequence", async () => {
    mocks.deleteSequence.mockRejectedValue(new Error("sequence_active"));

    const response = await requestApp(app(), "/sequences/seq_1", { method: "DELETE" });

    expect(response.status).toBe(409);
    expect(response.json<unknown>()).toEqual({ error: "sequence_active" });
  });

  it("answers 204 once deleted and 404 when missing", async () => {
    mocks.deleteSequence.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect(
      (await requestApp(app(), "/sequences/seq_1", { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await requestApp(app(), "/sequences/seq_1", { method: "DELETE" })).status,
    ).toBe(404);
    expect(mocks.deleteSequence).toHaveBeenCalledWith({
      teamId: "team-1",
      sequenceId: "seq_1",
    });
  });

  it("previews the deletion for the caller's team", async () => {
    const preview = {
      status: "paused",
      blocker: null,
      enrolledCount: 3,
      emailsSentCount: 9,
    };
    mocks.getSequenceDeletionImpact.mockResolvedValue(preview);

    const response = await requestApp(app(), "/sequences/seq_1/deletion-preview");

    expect(response.status).toBe(200);
    expect(response.json<unknown>()).toEqual(preview);
    expect(mocks.getSequenceDeletionImpact).toHaveBeenCalledWith("team-1", "seq_1");
  });
});

describe("broadcast archive routes", () => {
  it("answers 409 broadcast_sent when deleting a sent broadcast", async () => {
    mocks.deleteSequence.mockRejectedValue(new Error("broadcast_sent"));

    const response = await requestApp(app(), "/sequences/seq_1", { method: "DELETE" });

    expect(response.status).toBe(409);
    expect(response.json<unknown>()).toEqual({ error: "broadcast_sent" });
  });

  it("archives and restores, and refuses unsent broadcasts with 409", async () => {
    mocks.setBroadcastArchived
      .mockResolvedValueOnce({
        sequenceId: "seq_1",
        archivedAt: new Date(0),
        emails: [],
      })
      .mockResolvedValueOnce({ sequenceId: "seq_1", archivedAt: null, emails: [] })
      .mockRejectedValueOnce(new Error("broadcast_not_sent"))
      .mockResolvedValueOnce(null);

    const archived = await requestApp(app(), "/sequences/seq_1/archive", {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(archived.json<any>().archivedAt).toBe(new Date(0).toISOString());
    expect(mocks.setBroadcastArchived).toHaveBeenLastCalledWith({
      teamId: "team-1",
      sequenceId: "seq_1",
      archived: true,
    });

    const restored = await requestApp(app(), "/sequences/seq_1/unarchive", {
      method: "POST",
    });
    expect(restored.json<any>().archivedAt).toBeNull();
    expect(mocks.setBroadcastArchived).toHaveBeenLastCalledWith({
      teamId: "team-1",
      sequenceId: "seq_1",
      archived: false,
    });

    const draft = await requestApp(app(), "/sequences/seq_1/archive", {
      method: "POST",
    });
    expect(draft.status).toBe(409);
    expect(draft.json<unknown>()).toEqual({ error: "broadcast_not_sent" });
    expect(
      (await requestApp(app(), "/sequences/seq_9/archive", { method: "POST" })).status,
    ).toBe(404);
  });

  it("passes the archived filter to the list", async () => {
    mocks.listSequences.mockResolvedValue([]);
    mocks.countSequences.mockResolvedValue(0);

    const response = await requestApp(app(), "/sequences?type=broadcast&archived=only");

    expect(response.status).toBe(200);
    expect(mocks.listSequences).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        type: "broadcast",
        archived: "only",
      }),
    );
    expect(mocks.countSequences).toHaveBeenCalledWith("team-1", "broadcast", "only");
  });
});
