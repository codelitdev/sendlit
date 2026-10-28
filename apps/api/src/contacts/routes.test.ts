import { describe, expect, it, mock, vi } from "bun:test";
import express from "express";

const mocks = {
  exportContactsCsv: vi.fn(),
  getContactByContactId: vi.fn(),
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
