import { beforeEach, describe, expect, it, type Mock, mock, vi } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
mock.module("../mail/send", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: null, providerResponse: null }),
}));

const { db } = await import("../db/client");
const { contacts, emailContentVersions, ongoingSequences, sequenceEmails, sequences } =
  await import("../db/schema");
const { sendMail } = await import("../mail/send");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedOngoingSequence, seedSequence } = await import(
  "../test/fixtures"
);
const { processOngoingSequence } = await import(
  "../automation/process-ongoing-sequence"
);
const { lockBroadcast } = await import("../automation/queries");
const { getSequenceBySequenceId, updateMailInSequence, updateSequence } = await import(
  "./queries"
);
const {
  discardEmailChanges,
  listEmailVersions,
  publishEmailChanges,
  restoreEmailVersion,
} = await import("./publish");

const tdb = db as unknown as TestDb;
const mockedSendMail = sendMail as unknown as Mock<typeof sendMail>;

beforeEach(async () => {
  await truncateAll(tdb);
  mockedSendMail.mockClear();
});

async function seedRunningSequence(status = "active") {
  const { team, contact } = await seedTeamAndContact(tdb);
  const { sequenceRow, emailRows } = await seedSequence(tdb, {
    teamId: team.id,
    status,
    emails: [
      { emailId: "email_e1", subject: "Welcome", delayInMillis: 0 },
      { emailId: "email_e2", subject: "Day two", delayInMillis: 0 },
    ],
  });
  return { team, contact, sequenceRow, emailRows };
}

async function addContact(teamId: string, email: string) {
  const [row] = await tdb
    .insert(contacts)
    .values({ teamId, email, unsubscribeToken: crypto.randomUUID() })
    .returning();
  return row;
}

/** Sends `contact` their next email and returns its subject and HTML. */
async function sendNext(teamId: string, sequenceId: string, contactId: string) {
  const [existing] = await tdb
    .select()
    .from(ongoingSequences)
    .where(eq(ongoingSequences.contactId, contactId));
  const row =
    existing ?? (await seedOngoingSequence(tdb, { teamId, sequenceId, contactId }));
  await tdb
    .update(ongoingSequences)
    .set({ nextEmailScheduledTime: Date.now() - 1000 })
    .where(eq(ongoingSequences.id, row.id));
  mockedSendMail.mockClear();
  await processOngoingSequence(row.id);
  expect(mockedSendMail).toHaveBeenCalledTimes(1);
  const sent = mockedSendMail.mock.calls[0][0];
  return { subject: sent.subject, html: sent.html };
}

async function emailRow(id: string) {
  const [row] = await tdb
    .select()
    .from(sequenceEmails)
    .where(eq(sequenceEmails.id, id));
  return row;
}

const editedContent = () => emailContent({ text: "Edited body" });

describe("saving an email of a started sequence", () => {
  it("saves a draft and keeps sending the published version", async () => {
    const { team, contact, sequenceRow, emailRows } = await seedRunningSequence();

    const updated = await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e1",
      subject: "Half-finished {{ broken",
      content: editedContent(),
    });

    const email = updated!.emails.find((e) => e.emailId === "email_e1")!;
    expect(email.subject).toBe("Welcome");
    expect(email.draftSubject).toBe("Half-finished {{ broken");
    expect(JSON.stringify(email.draftContent)).toContain("Edited body");

    const sent = await sendNext(team.id, sequenceRow.id, contact.id);
    expect(sent.subject).toBe("Welcome");
    expect(sent.html).not.toContain("Edited body");
    expect((await emailRow(emailRows[0].id)).draftSubject).toBe(
      "Half-finished {{ broken",
    );
  });

  it("drops a draft that matches the published version again", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence();
    const args = {
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e1",
    };
    await updateMailInSequence({ ...args, subject: "Changed" });
    expect((await emailRow(emailRows[0].id)).draftSubject).toBe("Changed");

    await updateMailInSequence({ ...args, subject: "Welcome" });
    const row = await emailRow(emailRows[0].id);
    expect(row.draftSubject).toBeNull();
    expect(row.draftContent).toBeNull();
  });

  it("applies delay and step changes right away", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence();
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e2",
      delayInMillis: 5_000,
      published: false,
    });
    const row = await emailRow(emailRows[1].id);
    expect(row.delayInMillis).toBe(5_000);
    expect(row.published).toBe(false);
    expect(row.draftSubject).toBeNull();
  });

  it("saves directly while paused, folding in an open draft", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence();
    const args = {
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e1",
    };
    await updateMailInSequence({ ...args, content: editedContent() });
    await tdb
      .update(sequences)
      .set({ status: "paused" })
      .where(eq(sequences.id, sequenceRow.id));

    await updateMailInSequence({ ...args, subject: "Paused edit" });
    const row = await emailRow(emailRows[0].id);
    expect(row.subject).toBe("Paused edit");
    expect(JSON.stringify(row.content)).toContain("Edited body");
    expect(row.draftSubject).toBeNull();
  });

  it("saves directly before the sequence has started", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence("draft");
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e1",
      subject: "New subject",
    });
    const row = await emailRow(emailRows[0].id);
    expect(row.subject).toBe("New subject");
    expect(row.draftSubject).toBeNull();
  });
});

describe("publishEmailChanges", () => {
  it("makes the draft live and keeps the replaced version in the history", async () => {
    const { team, contact, sequenceRow, emailRows } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateMailInSequence({
      ...ids,
      emailId: "email_e1",
      subject: "Welcome aboard",
      content: editedContent(),
    });

    const published = await publishEmailChanges(ids);
    const email = published!.emails.find((e) => e.emailId === "email_e1")!;
    expect(email.subject).toBe("Welcome aboard");
    expect(email.draftSubject).toBeNull();

    const sent = await sendNext(team.id, sequenceRow.id, contact.id);
    expect(sent.subject).toBe("Welcome aboard");
    expect(sent.html).toContain("Edited body");

    const versions = await listEmailVersions({ ...ids, emailId: "email_e1" });
    expect(versions!.map((v) => [v.subject, v.live])).toEqual([
      ["Welcome aboard", true],
      ["Welcome", false],
    ]);
    // Publishing again with nothing new changes nothing.
    await publishEmailChanges(ids);
    expect((await emailRow(emailRows[0].id)).subject).toBe("Welcome aboard");
  });

  it("only publishes the emails asked for", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateMailInSequence({ ...ids, emailId: "email_e1", subject: "One" });
    await updateMailInSequence({ ...ids, emailId: "email_e2", subject: "Two" });

    await publishEmailChanges({ ...ids, emailIds: ["email_e2"] });
    expect((await emailRow(emailRows[0].id)).draftSubject).toBe("One");
    expect((await emailRow(emailRows[1].id)).subject).toBe("Two");

    await expect(
      publishEmailChanges({ ...ids, emailIds: ["email_nope"] }),
    ).rejects.toThrow("email_not_found");
  });

  it("keeps in-flight contacts on their version for new entrants only", async () => {
    const { team, contact, sequenceRow } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    // Already in the sequence, and has had the first email.
    await sendNext(team.id, sequenceRow.id, contact.id);

    await updateMailInSequence({ ...ids, emailId: "email_e2", subject: "Day two v2" });
    await publishEmailChanges({ ...ids, scope: "new_entrants" });

    const inFlight = await sendNext(team.id, sequenceRow.id, contact.id);
    expect(inFlight.subject).toBe("Day two");

    // Someone who enters after the publish gets the new version.
    const newcomer = await addContact(team.id, "newcomer@inbox.sendlit.app");
    await sendNext(team.id, sequenceRow.id, newcomer.id);
    const fresh = await sendNext(team.id, sequenceRow.id, newcomer.id);
    expect(fresh.subject).toBe("Day two v2");
  });

  it("gives in-flight contacts the new version by default", async () => {
    const { team, contact, sequenceRow } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await sendNext(team.id, sequenceRow.id, contact.id);

    await updateMailInSequence({ ...ids, emailId: "email_e2", subject: "Day two v2" });
    await publishEmailChanges({ ...ids, scope: "new_entrants" });
    await updateMailInSequence({ ...ids, emailId: "email_e2", subject: "Day two v3" });
    // A later publish to everyone lifts the earlier pin too.
    await publishEmailChanges(ids);

    const [row] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.contactId, contact.id));
    expect(row.pinnedVersions).toBeNull();
    expect((await sendNext(team.id, sequenceRow.id, contact.id)).subject).toBe(
      "Day two v3",
    );
  });
});

describe("discardEmailChanges", () => {
  it("throws the draft away", async () => {
    const { team, sequenceRow, emailRows } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateMailInSequence({ ...ids, emailId: "email_e1", subject: "Oops" });

    const after = await discardEmailChanges({ ...ids, emailIds: ["email_e1"] });
    expect(after!.emails.every((e) => e.draftSubject === null)).toBe(true);
    expect((await emailRow(emailRows[0].id)).subject).toBe("Welcome");
  });
});

describe("restoreEmailVersion", () => {
  it("rolls a publish back through the draft", async () => {
    const { team, contact, sequenceRow } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateMailInSequence({ ...ids, emailId: "email_e1", subject: "Bad edit" });
    await publishEmailChanges(ids);

    const versions = await listEmailVersions({ ...ids, emailId: "email_e1" });
    const previous = versions!.find((v) => !v.live)!;
    const restored = await restoreEmailVersion({
      ...ids,
      emailId: "email_e1",
      versionId: previous.versionId,
    });
    const email = restored!.emails.find((e) => e.emailId === "email_e1")!;
    // Restored into the draft; still live until published.
    expect(email.subject).toBe("Bad edit");
    expect(email.draftSubject).toBe("Welcome");

    await publishEmailChanges(ids);
    expect((await sendNext(team.id, sequenceRow.id, contact.id)).subject).toBe(
      "Welcome",
    );

    await expect(
      restoreEmailVersion({ ...ids, emailId: "email_e1", versionId: "ver_missing" }),
    ).rejects.toThrow("version_not_found");
  });
});

describe("a scheduled broadcast", () => {
  async function seedScheduledBroadcast() {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      // Scheduled, not sent yet.
      report: {},
      emails: [{ emailId: "email_b1", subject: "Launch", delayInMillis: 0 }],
    });
    await tdb
      .update(sequences)
      .set({ title: "Launch" })
      .where(eq(sequences.id, sequenceRow.id));
    return { team, contact, sequenceRow, emailRows };
  }

  it("sends the published content while edits are unpublished", async () => {
    const { team, contact, sequenceRow, emailRows } = await seedScheduledBroadcast();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateSequence({ ...ids, title: "Launch (draft)" });
    await updateMailInSequence({
      ...ids,
      emailId: "email_b1",
      content: editedContent(),
    });

    const row = await emailRow(emailRows[0].id);
    expect(row.subject).toBe("Launch");
    expect(row.draftSubject).toBe("Launch (draft)");
    // The title stays the subject it would be sent with.
    const [broadcast] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceRow.id));
    expect(broadcast.title).toBe("Launch");

    const sent = await sendNext(team.id, sequenceRow.id, contact.id);
    expect(sent.subject).toBe("Launch");
    expect(sent.html).not.toContain("Edited body");
  });

  it("takes the new title when its subject is published", async () => {
    const { team, sequenceRow } = await seedScheduledBroadcast();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateSequence({ ...ids, title: "Renamed" });
    expect(
      (await getSequenceBySequenceId(team.id, sequenceRow.sequenceId))!.title,
    ).toBe("Launch");

    const published = await publishEmailChanges(ids);
    expect(published!.title).toBe("Renamed");
    expect(published!.emails[0].subject).toBe("Renamed");
  });

  it("drops unpublished changes when it starts sending", async () => {
    const { team, sequenceRow, emailRows } = await seedScheduledBroadcast();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateSequence({ ...ids, title: "Renamed" });

    await lockBroadcast(sequenceRow.id, []);

    const row = await emailRow(emailRows[0].id);
    expect(row.subject).toBe("Launch");
    expect(row.draftSubject).toBeNull();
    expect(row.draftContent).toBeNull();
  });

  it("can't be published once it has started sending", async () => {
    const { team, sequenceRow } = await seedScheduledBroadcast();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    await updateSequence({ ...ids, title: "Renamed" });
    await tdb
      .update(sequences)
      .set({ report: { broadcast: { lockedAt: Date.now(), sentAt: null } } })
      .where(eq(sequences.id, sequenceRow.id));

    await expect(publishEmailChanges(ids)).rejects.toThrow("mail_already_sent");
  });
});

describe("version history", () => {
  it("lists published versions newest first", async () => {
    const { team, sequenceRow } = await seedRunningSequence();
    const ids = { teamId: team.id, sequenceId: sequenceRow.sequenceId };
    for (const subject of ["Second", "Third"]) {
      await updateMailInSequence({ ...ids, emailId: "email_e1", subject });
      await publishEmailChanges(ids);
    }
    const versions = await listEmailVersions({ ...ids, emailId: "email_e1" });
    expect(versions!.map((v) => v.subject)).toEqual(["Third", "Second", "Welcome"]);
  });

  it("lists the live version of an email published before history was kept", async () => {
    const { team, sequenceRow } = await seedRunningSequence();
    const versions = await listEmailVersions({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: "email_e1",
    });
    expect(versions).toHaveLength(1);
    expect(versions![0]).toMatchObject({ subject: "Welcome", live: true });
    const stored = await tdb.select().from(emailContentVersions);
    expect(stored.every((row) => row.publishedAt !== null)).toBe(true);
  });
});
