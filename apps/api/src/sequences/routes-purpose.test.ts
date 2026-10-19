import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const mocks = {
  createSequence: vi.fn(),
  addMailToSequence: vi.fn(),
  updateMailInSequence: vi.fn(),
  sendSequenceEmailTest: vi.fn(),
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
  countSequences: vi.fn(),
  deleteSequence: vi.fn(),
  deleteMailFromSequence: vi.fn(),
  getEmailSentCount: vi.fn(),
  getSequenceBySequenceId: vi.fn(),
  getSequenceClickThroughRate: vi.fn(),
  getSequenceOpenRate: vi.fn(),
  getSubscribers: vi.fn(),
  getSubscribersCount: vi.fn(),
  listSequences: vi.fn(),
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
