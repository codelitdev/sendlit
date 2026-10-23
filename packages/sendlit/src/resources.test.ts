import { describe, expect, it } from "bun:test";
import { mockSendLit } from "./test-utils";

type Case = [
  string,
  (sendlit: ReturnType<typeof mockSendLit>["sendlit"]) => Promise<unknown>,
  { method: string; path: string; query?: string; body?: unknown },
];

const cases: Case[] = [
  [
    "contacts.create",
    (s) =>
      s.contacts.create({
        email: "ada@example.com",
        name: "Ada",
        tags: ["courselit"],
        customFields: { plan: "pro" },
      }),
    {
      method: "POST",
      path: "/contacts",
      body: {
        email: "ada@example.com",
        name: "Ada",
        tags: ["courselit"],
        customFields: { plan: "pro" },
      },
    },
  ],
  [
    "contacts.list",
    (s) => s.contacts.list({ q: "ada", offset: 2, rowsPerPage: 10 }),
    {
      method: "GET",
      path: "/contacts",
      query: "?q=ada&offset=2&rowsPerPage=10",
    },
  ],
  [
    "contacts.update",
    (s) => s.contacts.update("con_1", { subscribed: false }),
    {
      method: "PATCH",
      path: "/contacts/con_1",
      body: { subscribed: false },
    },
  ],
  [
    "contacts.remove",
    (s) => s.contacts.remove("con_1"),
    { method: "DELETE", path: "/contacts/con_1" },
  ],
  [
    "contacts.removeTag",
    (s) => s.contacts.removeTag("con_1", "vip"),
    { method: "DELETE", path: "/contacts/con_1/tags/vip" },
  ],
  [
    "contacts.deliveries",
    (s) => s.contacts.deliveries("con_1"),
    { method: "GET", path: "/contacts/con_1/deliveries" },
  ],
  [
    "segments.create",
    (s) =>
      s.segments.create({
        name: "Pro",
        filter: { aggregator: "and", filters: [] },
      }),
    {
      method: "POST",
      path: "/segments",
      body: { name: "Pro", filter: { aggregator: "and", filters: [] } },
    },
  ],
  [
    "segments.update",
    (s) => s.segments.update("seg_1", { name: "Pro users" }),
    {
      method: "PATCH",
      path: "/segments/seg_1",
      body: { name: "Pro users" },
    },
  ],
  [
    "templates.list",
    (s) => s.templates.list({ purpose: "marketing" }),
    { method: "GET", path: "/templates", query: "?purpose=marketing" },
  ],
  [
    "templates.listSystem",
    (s) => s.templates.listSystem(),
    { method: "GET", path: "/system-templates" },
  ],
  [
    "templates.duplicate",
    (s) => s.templates.duplicate("tpl_1", { title: "Copy" }),
    {
      method: "POST",
      path: "/templates/tpl_1/duplicate",
      body: { title: "Copy" },
    },
  ],
  [
    "templates.remove",
    (s) => s.templates.remove("tpl_1"),
    { method: "DELETE", path: "/templates/tpl_1" },
  ],
  [
    "sequences.create",
    (s) => s.sequences.create({ type: "broadcast", templateId: "tpl_1" }),
    {
      method: "POST",
      path: "/sequences",
      body: { type: "broadcast", templateId: "tpl_1" },
    },
  ],
  [
    "sequences.list",
    (s) => s.sequences.list({ type: "sequence" }),
    { method: "GET", path: "/sequences", query: "?type=sequence" },
  ],
  [
    "sequences.update",
    (s) =>
      s.sequences.update("seq_1", {
        triggerType: "subscriber:added",
      }),
    {
      method: "PATCH",
      path: "/sequences/seq_1",
      body: { triggerType: "subscriber:added" },
    },
  ],
  [
    "sequences.addEmail",
    (s) => s.sequences.addEmail("seq_1", { templateId: "tpl_1" }),
    {
      method: "POST",
      path: "/sequences/seq_1/emails",
      body: { templateId: "tpl_1" },
    },
  ],
  [
    "sequences.updateEmail",
    (s) =>
      s.sequences.updateEmail("seq_1", "eml_1", {
        subject: "Welcome",
        published: true,
      }),
    {
      method: "PATCH",
      path: "/sequences/seq_1/emails/eml_1",
      body: { subject: "Welcome", published: true },
    },
  ],
  [
    "sequences.removeEmail",
    (s) => s.sequences.removeEmail("seq_1", "eml_1"),
    { method: "DELETE", path: "/sequences/seq_1/emails/eml_1" },
  ],
  [
    "sequences.start",
    (s) => s.sequences.start("seq_1"),
    { method: "POST", path: "/sequences/seq_1/start" },
  ],
  [
    "sequences.pause",
    (s) => s.sequences.pause("seq_1"),
    { method: "POST", path: "/sequences/seq_1/pause" },
  ],
  [
    "sequences.stats",
    (s) => s.sequences.stats("seq_1"),
    { method: "GET", path: "/sequences/seq_1/stats" },
  ],
  [
    "sequences.subscribers",
    (s) => s.sequences.subscribers("seq_1", { page: 1, limit: 20 }),
    {
      method: "GET",
      path: "/sequences/seq_1/subscribers",
      query: "?page=1&limit=20",
    },
  ],
  [
    "emails.send",
    (s) =>
      s.emails.send({
        to: "ada@example.com",
        subject: "Your receipt",
        templateId: "tpl_1",
        variables: { amount: 10 },
        idempotencyKey: "order_1",
      }),
    {
      method: "POST",
      path: "/emails",
      body: {
        to: "ada@example.com",
        subject: "Your receipt",
        templateId: "tpl_1",
        variables: { amount: 10 },
        idempotencyKey: "order_1",
      },
    },
  ],
  [
    "emails.get",
    (s) => s.emails.get("txe_1"),
    { method: "GET", path: "/emails/txe_1" },
  ],
  [
    "emails.list",
    (s) => s.emails.list({ status: "sent" }),
    { method: "GET", path: "/emails", query: "?status=sent" },
  ],
  [
    "provisioning.provisionTeam",
    (s) =>
      s.provisioning.provisionTeam({
        externalId: "school_1",
        name: "Acme",
      }),
    {
      method: "POST",
      path: "/provisioning/teams",
      body: { externalId: "school_1", name: "Acme" },
    },
  ],
  [
    "provisioning.updateTeam",
    (s) => s.provisioning.updateTeam("team_1", { name: "Acme 2" }),
    {
      method: "PATCH",
      path: "/provisioning/teams/team_1",
      body: { name: "Acme 2" },
    },
  ],
  [
    "provisioning.createTeamKey",
    (s) => s.provisioning.createTeamKey("team_1", { name: "prod" }),
    {
      method: "POST",
      path: "/provisioning/teams/team_1/keys",
      body: { name: "prod" },
    },
  ],
  [
    "provisioning.suspendTeam",
    (s) => s.provisioning.suspendTeam("team_1"),
    { method: "POST", path: "/provisioning/teams/team_1/suspend" },
  ],
  [
    "provisioning.resumeTeam",
    (s) => s.provisioning.resumeTeam("team_1"),
    { method: "POST", path: "/provisioning/teams/team_1/resume" },
  ],
  [
    "provisioning.archiveTeam",
    (s) => s.provisioning.archiveTeam("team_1"),
    { method: "DELETE", path: "/provisioning/teams/team_1" },
  ],
  [
    "provisioning.getTeamUsage",
    (s) => s.provisioning.getTeamUsage("team_1"),
    { method: "GET", path: "/provisioning/teams/team_1/usage" },
  ],
  [
    "suppressions.list",
    (s) => s.suppressions.list({ reason: "hard_bounce" }),
    { method: "GET", path: "/suppressions", query: "?reason=hard_bounce" },
  ],
  [
    "suppressions.get",
    (s) => s.suppressions.get("sup_1"),
    { method: "GET", path: "/suppressions/sup_1" },
  ],
  [
    "suppressions.release",
    (s) => s.suppressions.release("sup_1", { explanation: "Fixed" }),
    {
      method: "POST",
      path: "/suppressions/sup_1/release",
      body: { explanation: "Fixed" },
    },
  ],
  [
    "deliveryEvents.list",
    (s) => s.deliveryEvents.list({ itemsPerPage: 5 }),
    { method: "GET", path: "/delivery-events", query: "?itemsPerPage=5" },
  ],
  [
    "deliveryEvents.get",
    (s) => s.deliveryEvents.get("dev_1"),
    { method: "GET", path: "/delivery-events/dev_1" },
  ],
];

describe("resources", () => {
  it.each(cases)("%s", async (_name, run, expected) => {
    const { sendlit, requests } = mockSendLit();
    await run(sendlit);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe(expected.method);
    expect(request.url.pathname).toBe(expected.path);
    expect(request.url.search).toBe(expected.query ?? "");
    expect(request.body).toEqual(expected.body);
    if (expected.body !== undefined) {
      expect(request.headers["content-type"]).toBe("application/json");
    }
  });

  it("resolves void for 204 responses", async () => {
    const { sendlit } = mockSendLit({ status: 204 });
    await expect(sendlit.segments.remove("seg_1")).resolves.toBeUndefined();
  });

  it("returns the response body", async () => {
    const contact = { contactId: "con_1", email: "ada@example.com" };
    const { sendlit } = mockSendLit({ status: 201, body: contact });
    await expect(
      sendlit.contacts.create({ email: "ada@example.com" }) as Promise<unknown>,
    ).resolves.toEqual(contact);
  });
});

describe("listAll", () => {
  it("walks every page until total is reached", async () => {
    const { sendlit, requests } = mockSendLit([
      {
        status: 200,
        body: {
          items: [{ contactId: "con_1" }, { contactId: "con_2" }],
          total: 3,
        },
      },
      {
        status: 200,
        body: { items: [{ contactId: "con_3" }], total: 3 },
      },
    ]);
    const ids: string[] = [];
    for await (const contact of sendlit.contacts.listAll({
      q: "a",
      rowsPerPage: 2,
    })) {
      ids.push(contact.contactId);
    }
    expect(ids).toEqual(["con_1", "con_2", "con_3"]);
    expect(requests.map((r) => r.url.search)).toEqual([
      "?q=a&rowsPerPage=2&offset=1",
      "?q=a&rowsPerPage=2&offset=2",
    ]);
  });

  it("stops on an empty page", async () => {
    const { sendlit, requests } = mockSendLit({
      status: 200,
      body: { items: [], total: 10 },
    });
    const items = [];
    for await (const item of sendlit.emails.listAll()) items.push(item);
    expect(items).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});
