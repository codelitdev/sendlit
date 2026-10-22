import { beforeEach, describe, expect, it, type Mock, mock, vi } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
mock.module("./test-send-limits", () => ({
  takeTestSendQuota: vi.fn().mockResolvedValue(undefined),
}));
mock.module("../mail/send", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: null, providerResponse: null }),
}));

const { db } = await import("../db/client");
const { contacts, sequenceEmails, settings } = await import("../db/schema");
const { addOrStrengthenSuppression } = await import(
  "../delivery-feedback/suppression-queries"
);
const { sendMail } = await import("../mail/send");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedSequence } = await import("../test/fixtures");
const { verifyCampaignViewToken } = await import("../mail/campaign");
const { getContentVersion } = await import("./content-versions");
const { TEST_CONTACT_ID } = await import("../config/constants");
const { verifyPixelToken } = await import("../utils/pixel-jwt");
const { sendSequenceEmailTest } = await import("./test-send");
const { takeTestSendQuota } = await import("./test-send-limits");
const mockedTakeQuota = takeTestSendQuota as unknown as Mock<typeof takeTestSendQuota>;

const tdb = db as unknown as TestDb;
const mockedSendMail = sendMail as unknown as Mock<typeof sendMail>;

beforeEach(async () => {
  await truncateAll(tdb);
  mockedSendMail.mockClear();
  mockedTakeQuota.mockClear();
  mockedTakeQuota.mockResolvedValue(undefined);
});

async function seed() {
  const { team, contact } = await seedTeamAndContact(tdb);
  const { sequenceRow, emailRows } = await seedSequence(tdb, {
    teamId: team.id,
    type: "broadcast",
    status: "draft",
    emails: [{ emailId: "email_e1", subject: "Hello" }],
  });
  return { team, contact, sequenceRow, email: emailRows[0] };
}

describe("sendSequenceEmailTest", () => {
  it("sends a [Test] copy that tracks and unsubscribes nobody", async () => {
    const { team, sequenceRow, email } = await seed();

    const result = await sendSequenceEmailTest({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: email.emailId,
      to: ["Me@Example.com"],
    });

    expect(result.sent).toEqual(["me@example.com"]);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    const sent = mockedSendMail.mock.calls[0][0];
    expect(sent.subject).toBe("[Test] Hello");
    expect(sent.to).toBe("me@example.com");
    expect(sent.headers?.["List-Unsubscribe"]).toContain("/unsubscribe/test");
    const pixelToken = new URL(
      sent.html.match(/src="([^"]*\/track\/open[^"]*)"/)?.[1] ?? "http://x",
    ).searchParams.get("d");
    expect(verifyPixelToken<{ contactId: string }>(pixelToken ?? "")?.contactId).toBe(
      TEST_CONTACT_ID,
    );

    const [row] = await tdb
      .select()
      .from(sequenceEmails)
      .where(eq(sequenceEmails.id, email.id));
    expect(row.lastTestSentAt).toBeInstanceOf(Date);
    expect(result.lastTestSentAt).toBe(row.lastTestSentAt?.toISOString() ?? null);
  });

  it("links a web version of the email as tested, not later edits", async () => {
    const { team, sequenceRow, email } = await seed();

    await sendSequenceEmailTest({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: email.emailId,
      to: ["me@example.com"],
    });
    await tdb
      .update(sequenceEmails)
      .set({ content: emailContent({ text: "Edited after the test" }) })
      .where(eq(sequenceEmails.id, email.id));

    const viewUrl = mockedSendMail.mock.calls[0][0].html.match(
      /href="(https:\/\/sendlit\.test\/view\/[^"]+)"/,
    )?.[1];
    const ids = verifyCampaignViewToken(
      new URL(viewUrl ?? "http://x").pathname.slice(6),
    );
    expect(ids?.contactId).toBe(TEST_CONTACT_ID);
    const version = await getContentVersion(email.id, ids?.versionId ?? "");
    expect(JSON.stringify(version?.content)).toContain("Hello {{ subscriber.name }}!");
    expect(JSON.stringify(version?.content)).not.toContain("Edited after the test");
  });

  it("defaults to the fallback recipient and uses their contact data", async () => {
    const { team, contact, sequenceRow, email } = await seed();
    await tdb
      .update(contacts)
      .set({ name: "Jane Reader" })
      .where(eq(contacts.id, contact.id));

    const result = await sendSequenceEmailTest({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: email.emailId,
      fallbackRecipient: contact.email,
    });

    expect(result.sent).toEqual([contact.email]);
  });

  it("requires a recipient when there is no fallback", async () => {
    const { team, sequenceRow, email } = await seed();
    await expect(
      sendSequenceEmailTest({
        teamId: team.id,
        sequenceId: sequenceRow.sequenceId,
        emailId: email.emailId,
      }),
    ).rejects.toThrow("test_recipients_required");
  });

  it("skips suppressed recipients and doesn't stamp lastTestSentAt", async () => {
    const { team, sequenceRow, email } = await seed();
    await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "bounced@example.com",
      reason: "complaint",
      actorType: "system",
    });

    const result = await sendSequenceEmailTest({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: email.emailId,
      to: ["bounced@example.com"],
    });

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([
      { email: "bounced@example.com", reason: "suppressed" },
    ]);
    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(result.lastTestSentAt).toBeNull();
  });

  it("counts each deliverable recipient and sends nothing past the limit", async () => {
    const { team, sequenceRow, email } = await seed();
    await sendSequenceEmailTest({
      teamId: team.id,
      sequenceId: sequenceRow.sequenceId,
      emailId: email.emailId,
      to: ["a@example.com", "B@example.com", "b@example.com"],
    });
    expect(mockedTakeQuota).toHaveBeenCalledWith({
      teamId: team.id,
      emailId: email.emailId,
      recipients: 2,
    });

    mockedSendMail.mockClear();
    mockedTakeQuota.mockRejectedValueOnce(new Error("test_send_limit_reached"));
    await expect(
      sendSequenceEmailTest({
        teamId: team.id,
        sequenceId: sequenceRow.sequenceId,
        emailId: email.emailId,
        to: ["a@example.com"],
      }),
    ).rejects.toThrow("test_send_limit_reached");
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it("404s an email of another sequence", async () => {
    const { team, sequenceRow } = await seed();
    await expect(
      sendSequenceEmailTest({
        teamId: team.id,
        sequenceId: sequenceRow.sequenceId,
        emailId: "email_missing",
        to: ["me@example.com"],
      }),
    ).rejects.toThrow("email_not_found");
  });

  it("asks for the mailing address before rendering when it's missing", async () => {
    const { team, sequenceRow, email } = await seed();
    await tdb
      .update(settings)
      .set({ mailingAddress: null })
      .where(eq(settings.teamId, team.id));

    await expect(
      sendSequenceEmailTest({
        teamId: team.id,
        sequenceId: sequenceRow.sequenceId,
        emailId: email.emailId,
        to: ["me@example.com"],
      }),
    ).rejects.toThrow("mailing_address_required");
    expect(mockedSendMail).not.toHaveBeenCalled();
  });
});
