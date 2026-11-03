import { describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const mocks = {
  exportContactsCsv: vi.fn(),
  getContactByContactId: vi.fn(),
  startContactDeletion: vi.fn(),
  getContactDeletion: vi.fn(),
  selectionCondition: vi.fn(),
  countSelection: vi.fn(),
};

mock.module("../auth/middleware", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
mock.module("../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = "team-1";
    next();
  },
}));
mock.module("./export", () => ({ exportContactsCsv: mocks.exportContactsCsv }));
mock.module("./deletion-queue", () => ({
  startContactDeletion: mocks.startContactDeletion,
  getContactDeletion: mocks.getContactDeletion,
}));
mock.module("./bulk-delete", () => ({
  selectionCondition: mocks.selectionCondition,
  countSelection: mocks.countSelection,
}));
mock.module("./import", () => ({ importContacts: vi.fn() }));
mock.module("./segments-queries", () => ({ getSegment: vi.fn() }));
mock.module("../events/queries", () => ({ listContactEvents: vi.fn() }));
mock.module("./queries", () => ({
  addTagToContact: vi.fn(),
  countContacts: vi.fn(),
  createContact: vi.fn(),
  deleteContact: vi.fn(),
  getContactByContactId: mocks.getContactByContactId,
  getDeliveriesByContact: vi.fn(),
  listContacts: vi.fn(),
  removeTagFromContact: vi.fn(),
  updateContact: vi.fn(),
}));

const { requestApp } = await import("../test/http");
const { default: contactRoutes } = await import("./routes");

describe("GET /contacts/export", () => {
  it("serves CSV rather than looking up a contact called 'export'", async () => {
    mocks.exportContactsCsv.mockResolvedValue({
      csv: "email\r\na@x.com\r\n",
      count: 1,
    });
    const app = express();
    app.use(contactRoutes);

    const response = await requestApp(app, "/contacts/export");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"])).toContain("text/csv");
    expect(String(response.headers["content-disposition"])).toContain("attachment");
    expect(response.body).toBe("email\r\na@x.com\r\n");
    expect(mocks.getContactByContactId).not.toHaveBeenCalled();
  });
});

function appWithJson() {
  const app = express();
  app.use(express.json());
  app.use(contactRoutes);
  return app;
}

function post(path: string, body: unknown) {
  return requestApp(appWithJson(), path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("bulk contact deletion routes", () => {
  it("rejects a body with both or neither selection, or match without expectedCount", async () => {
    for (const body of [
      {},
      { contactIds: ["cnt_a"], match: {} },
      { match: {} },
      { contactIds: [] },
    ]) {
      const response = await post("/contacts/bulk-delete", body);
      expect(response.status).toBe(400);
    }
    expect(mocks.startContactDeletion).not.toHaveBeenCalled();
  });

  it("passes the team, selection, count and acting user through", async () => {
    mocks.startContactDeletion.mockResolvedValue({
      status: 202,
      body: {
        deletionId: "cdel_1",
        status: "queued",
        count: 5000,
        deleted: 0,
        suppressed: 0,
      },
    });

    const response = await post("/contacts/bulk-delete", {
      match: { q: "old" },
      expectedCount: 5000,
    });

    expect(response.status).toBe(202);
    expect(mocks.startContactDeletion).toHaveBeenCalledWith({
      teamId: "team-1",
      selection: { match: { q: "old" } },
      expectedCount: 5000,
      actorUserId: null,
    });
  });

  it("previews a selection's count", async () => {
    mocks.selectionCondition.mockResolvedValue({ condition: "sql" });
    mocks.countSelection.mockResolvedValue({ count: 3, unsubscribed: 1 });

    const response = await post("/contacts/bulk-delete/preview", { match: {} });

    expect(response.status).toBe(200);
    expect(JSON.parse(String(response.body))).toEqual({ count: 3, unsubscribed: 1 });
    expect(mocks.selectionCondition).toHaveBeenCalledWith("team-1", { match: {} });
  });

  it("404s a deletion from another team", async () => {
    mocks.getContactDeletion.mockResolvedValue(null);

    const response = await requestApp(appWithJson(), "/contacts/bulk-delete/cdel_x");

    expect(response.status).toBe(404);
    expect(mocks.getContactDeletion).toHaveBeenCalledWith("team-1", "cdel_x");
    expect(mocks.getContactByContactId).not.toHaveBeenCalled();
  });
});
