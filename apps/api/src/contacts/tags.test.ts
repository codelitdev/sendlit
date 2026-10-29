import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

const requestTeam = { id: "" };
const captured: { event: string; properties?: Record<string, unknown> }[] = [];
const fired: unknown[] = [];

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
mock.module("../auth/require-team", () => ({
  requireTeam: (req: any, _res: any, next: () => void) => {
    req.teamId = requestTeam.id;
    next();
  },
}));
mock.module("../observability", () => ({
  captureEvent: (event: any) => captured.push(event),
  captureError: () => {},
}));
mock.module("../automation/fire-event", () => ({
  fireEvent: async (event: unknown) => {
    fired.push(event);
  },
}));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { default: tagRoutes } = await import("./tags-routes");
const { registerTagTools } = await import("../mcp/tools/tags");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const tagIs = (value: string) => ({
  aggregator: "and" as const,
  filters: [{ name: "tag", condition: "is", value }],
});

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(tagRoutes);
  return instance;
}

async function addContact(teamId: string, tags: string[]) {
  const [row] = await tdb
    .insert(schema.contacts)
    .values({
      teamId,
      email: `c-${crypto.randomUUID()}@example.com`,
      unsubscribeToken: crypto.randomUUID(),
      tags,
    })
    .returning();
  return row;
}

/** A team where `vip` is on two contacts and named by every kind of reference. */
async function seedReferences() {
  const { team, contact } = await seedTeamAndContact(tdb, {
    contact: { tags: ["vip", "beta"] },
  });
  const other = await addContact(team.id, ["vip"]);
  await addContact(team.id, ["beta"]);
  const [segment] = await tdb
    .insert(schema.segments)
    .values({ teamId: team.id, name: "VIPs", filter: tagIs("vip") })
    .returning();
  const [sequence] = await tdb
    .insert(schema.sequences)
    .values({
      teamId: team.id,
      type: "sequence",
      title: "VIP onboarding",
      status: "active",
      triggerType: "tag:added",
      triggerData: "vip",
      excludeFilter: tagIs("vip"),
    })
    .returning();
  await tdb.insert(schema.rules).values({
    teamId: team.id,
    sequenceId: sequence.id,
    event: "tag:added",
    eventData: "vip",
  });
  await tdb.insert(schema.sequenceEmails).values({
    sequenceId: sequence.id,
    subject: "Welcome",
    content: {},
    actionType: "tag:remove",
    actionData: { tag: "vip" },
  });
  const [sent] = await tdb
    .insert(schema.sequences)
    .values({
      teamId: team.id,
      type: "broadcast",
      title: "Sent to VIPs",
      status: "completed",
      filter: tagIs("vip"),
    })
    .returning();
  const [form] = await tdb
    .insert(schema.signupForms)
    .values({ teamId: team.id, name: "VIP form", tags: ["vip"] })
    .returning();
  return { team, contact, other, segment, sequence, sent, form };
}

beforeEach(async () => {
  await truncateAll(tdb);
  captured.length = 0;
  fired.length = 0;
});

describe("tag routes", () => {
  it("lists the team's tags with contact counts, scoped to the team", async () => {
    const { team } = await seedReferences();
    const outsider = await seedTeamAndContact(tdb, { contact: { tags: ["vip"] } });
    await addContact(outsider.team.id, ["secret"]);
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags");

    expect(response.status).toBe(200);
    expect(response.json().items).toEqual([
      { tag: "beta", contactCount: 2 },
      { tag: "vip", contactCount: 2 },
    ]);
  });

  it("lists every reference to a tag", async () => {
    const { team, segment, sequence, sent, form } = await seedReferences();
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags/vip/references");

    expect(response.status).toBe(200);
    const body = response.json();
    expect(body.contactCount).toBe(2);
    expect(body.segments).toEqual([{ segmentId: segment.segmentId, name: "VIPs" }]);
    expect(body.signupForms).toEqual([{ formId: form.formId, name: "VIP form" }]);
    expect(body.sequences).toEqual([
      {
        sequenceId: sent.sequenceId,
        title: "Sent to VIPs",
        type: "broadcast",
        status: "completed",
        usages: ["filter"],
      },
      {
        sequenceId: sequence.sequenceId,
        title: "VIP onboarding",
        type: "sequence",
        status: "active",
        usages: ["exclude_filter", "trigger", "email_action"],
      },
    ]);
  });

  it("deletes a tag from every contact, leaves references and fires no tag events", async () => {
    const { team, contact, segment, form } = await seedReferences();
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags/vip", { method: "DELETE" });

    expect(response.status).toBe(200);
    const body = response.json();
    expect(body.contactsUpdated).toBe(2);
    expect(body.references.contactCount).toBe(0);
    expect(body.references.segments).toHaveLength(1);
    expect(body.references.sequences).toHaveLength(2);
    const [updated] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contact.id));
    expect(updated.tags).toEqual(["beta"]);
    const [keptSegment] = await tdb
      .select()
      .from(schema.segments)
      .where(eq(schema.segments.id, segment.id));
    expect(keptSegment.filter).toEqual(tagIs("vip"));
    const [keptForm] = await tdb
      .select()
      .from(schema.signupForms)
      .where(eq(schema.signupForms.id, form.id));
    expect(keptForm.tags).toEqual(["vip"]);
    expect(fired).toEqual([]);
    expect(captured).toEqual([
      expect.objectContaining({ event: "tag_deleted", properties: { count: 2 } }),
    ]);
  });

  it("does not touch another team's contacts", async () => {
    const { team } = await seedReferences();
    const outsider = await seedTeamAndContact(tdb, { contact: { tags: ["vip"] } });
    requestTeam.id = team.id;

    await requestApp(app(), "/tags/vip", { method: "DELETE" });

    const [kept] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, outsider.contact.id));
    expect(kept.tags).toEqual(["vip"]);
  });

  it("returns 404 for a tag nothing uses", async () => {
    const { team } = await seedTeamAndContact(tdb);
    requestTeam.id = team.id;

    const remove = await requestApp(app(), "/tags/missing", { method: "DELETE" });
    const rename = await requestApp(app(), "/tags/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "found" }),
    });

    expect(remove.status).toBe(404);
    expect(rename.status).toBe(404);
    expect(rename.json<object>()).toEqual({ error: "tag_not_found" });
  });

  it("renames a tag everywhere except sent broadcasts", async () => {
    const { team, contact, other, segment, sequence, sent, form } =
      await seedReferences();
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags/vip", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  gold  " }),
    });

    expect(response.status).toBe(200);
    expect(response.json<object>()).toEqual({
      tag: "gold",
      previousTag: "vip",
      contactsUpdated: 2,
      segmentsUpdated: 1,
      sequencesUpdated: 1,
      signupFormsUpdated: 1,
    });
    const tagsOf = async (id: string) =>
      (await tdb.select().from(schema.contacts).where(eq(schema.contacts.id, id)))[0]
        .tags;
    expect(await tagsOf(contact.id)).toEqual(["beta", "gold"]);
    expect(await tagsOf(other.id)).toEqual(["gold"]);
    const [renamedSegment] = await tdb
      .select()
      .from(schema.segments)
      .where(eq(schema.segments.id, segment.id));
    expect(renamedSegment.filter).toEqual(tagIs("gold"));
    const [renamedSequence] = await tdb
      .select()
      .from(schema.sequences)
      .where(eq(schema.sequences.id, sequence.id));
    expect(renamedSequence.triggerData).toBe("gold");
    expect(renamedSequence.excludeFilter).toEqual(tagIs("gold"));
    const [rule] = await tdb
      .select()
      .from(schema.rules)
      .where(eq(schema.rules.sequenceId, sequence.id));
    expect(rule.eventData).toBe("gold");
    const [email] = await tdb
      .select()
      .from(schema.sequenceEmails)
      .where(eq(schema.sequenceEmails.sequenceId, sequence.id));
    expect(email.actionData).toEqual({ tag: "gold" });
    const [sentBroadcast] = await tdb
      .select()
      .from(schema.sequences)
      .where(eq(schema.sequences.id, sent.id));
    expect(sentBroadcast.filter).toEqual(tagIs("vip"));
    const [renamedForm] = await tdb
      .select()
      .from(schema.signupForms)
      .where(eq(schema.signupForms.id, form.id));
    expect(renamedForm.tags).toEqual(["gold"]);
    expect(fired).toEqual([]);
  });

  it("merges into an existing tag without duplicating it", async () => {
    const { team, contact } = await seedReferences();
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags/vip", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "beta" }),
    });

    expect(response.status).toBe(200);
    const [merged] = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contact.id));
    expect(merged.tags).toEqual(["beta"]);
    const list = await requestApp(app(), "/tags");
    expect(list.json().items).toEqual([{ tag: "beta", contactCount: 3 }]);
  });

  it("rejects renaming a tag to itself", async () => {
    const { team } = await seedReferences();
    requestTeam.id = team.id;

    const response = await requestApp(app(), "/tags/vip", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vip" }),
    });

    expect(response.status).toBe(400);
    expect(response.json<object>()).toEqual({ error: "tag_unchanged" });
  });

  it("handles tags with reserved URL characters", async () => {
    const { team } = await seedTeamAndContact(tdb, { contact: { tags: ["tier:a/b"] } });
    requestTeam.id = team.id;

    const response = await requestApp(
      app(),
      `/tags/${encodeURIComponent("tier:a/b")}`,
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    expect(response.json().contactsUpdated).toBe(1);
  });
});

describe("MCP tag tools", () => {
  function tools() {
    const registered = new Map<string, { config: any; handler: any }>();
    registerTagTools({
      registerTool: (name: string, config: any, handler: any) => {
        registered.set(name, { config, handler });
      },
    } as any);
    return registered;
  }
  const authFor = (teamId: string) => ({
    http: { authInfo: { extra: { authKind: "team_key", teamId, user: null } } },
  });

  it("requires auth", async () => {
    const result = await tools().get("list_tags")!.handler({});
    expect(result.isError).toBe(true);
  });

  it("lists, inspects, renames and deletes tags with valid output", async () => {
    const { team } = await seedReferences();
    const registered = tools();
    const auth = authFor(team.id);
    const call = async (name: string, args?: unknown) => {
      const tool = registered.get(name)!;
      const result =
        args === undefined ? await tool.handler(auth) : await tool.handler(args, auth);
      expect(result.isError).toBeUndefined();
      expect(tool.config.outputSchema.safeParse(result.structuredContent).success).toBe(
        true,
      );
      return result.structuredContent;
    };

    expect((await call("list_tags")).items).toHaveLength(2);
    expect((await call("get_tag_references", { tag: "vip" })).segments).toHaveLength(1);
    expect((await call("rename_tag", { tag: "vip", name: "gold" })).tag).toBe("gold");
    expect((await call("delete_tag", { tag: "gold" })).contactsUpdated).toBe(2);

    const missing = await registered
      .get("delete_tag")!
      .handler({ tag: "nope" }, authFor(team.id));
    expect(missing.isError).toBe(true);
    expect(registered.get("delete_tag")!.config.annotations.destructiveHint).toBe(true);
  });
});
