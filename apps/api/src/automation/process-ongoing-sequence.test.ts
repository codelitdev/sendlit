import { beforeEach, describe, expect, it, type Mock, mock, vi } from "bun:test";
import { waitFor } from "@sendlit/test-utils";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});
mock.module("../mail/send", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: null, providerResponse: null }),
}));

const { db } = await import("../db/client");
const {
  contacts,
  emailDeliveries,
  espConfigs,
  ongoingSequences,
  outboundMessages,
  sequenceEmails,
  sequences,
} = await import("../db/schema");
const { addOrStrengthenSuppression } = await import(
  "../delivery-feedback/suppression-queries"
);
const { sendMail } = await import("../mail/send");
const { SendDeferredError } = await import("../mail/rate-limit");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedOngoingSequence, seedSequence } = await import(
  "../test/fixtures"
);
const { emailContentVersions } = await import("../db/schema");
const { default: webViewRoutes } = await import("../tracking/web-view");
const { requestApp } = await import("../test/http");
const express = (await import("express")).default;
const { getUnsubLink } = await import("../utils/mail");
const { getNextPublishedEmail, processOngoingSequence } = await import(
  "./process-ongoing-sequence"
);

const tdb = db as unknown as TestDb;
const mockedSendMail = sendMail as unknown as Mock<typeof sendMail>;

beforeEach(async () => {
  await truncateAll(tdb);
  mockedSendMail.mockClear();
  mockedSendMail.mockResolvedValue({
    messageId: null,
    providerResponse: null,
  });
});

describe("getNextPublishedEmail", () => {
  const email = (emailId: string, published = true) => ({ emailId, published }) as any;

  it("returns emails in emailsOrder, skipping already-sent ones", () => {
    const emails = [email("b"), email("a")];
    expect(
      getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: [] })?.emailId,
    ).toBe("a");
    expect(
      getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: ["a"] })?.emailId,
    ).toBe("b");
  });

  it("skips unpublished emails", () => {
    const emails = [email("a", false), email("b")];
    expect(
      getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: [] })?.emailId,
    ).toBe("b");
  });

  it("returns null when every published email has been sent", () => {
    const emails = [email("a"), email("b", false)];
    expect(
      getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: ["a"] }),
    ).toBeNull();
  });
});

describe("processOngoingSequence", () => {
  it("does nothing when the row is not yet due (duplicate-job guard)", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
      nextEmailScheduledTime: Date.now() + 60_000,
    });

    await processOngoingSequence(row.id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after.sentEmailIds).toEqual([]);
  });

  it("sends the next email, records the delivery, and schedules the follow-up", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [
        { emailId: "email_e1", subject: "First", delayInMillis: 0 },
        {
          emailId: "email_e2",
          subject: "Second",
          delayInMillis: 3_600_000,
        },
      ],
    });
    const scheduledAt = Date.now() - 1000;
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
      nextEmailScheduledTime: scheduledAt,
    });

    await processOngoingSequence(row.id);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    const sent = mockedSendMail.mock.calls[0][0];
    expect(sent.to).toBe(contact.email);
    expect(sent.subject).toBe("First");
    expect(sent.from).toBe("Test Sender <sender@example.com>");
    expect(sent.headers).toEqual({
      "List-Unsubscribe": `<${getUnsubLink(contact.unsubscribeToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });

    const deliveries = await tdb
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.contactId, contact.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].emailId).toBe(emailRows[0].id);

    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after.sentEmailIds).toEqual(["email_e1"]);
    expect(after.nextEmailScheduledTime).toBe(scheduledAt + 3_600_000);
  });

  it("adds the SES message tag alongside the unsubscribe headers and stores the bare SES id", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    await tdb
      .update(espConfigs)
      .set({ provider: "ses" })
      .where(eq(espConfigs.teamId, team.id));
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    mockedSendMail.mockResolvedValue({
      messageId: null,
      providerResponse: "250 Ok 0100018f-ses-id-000000",
    });

    await processOngoingSequence(row.id);

    const [outbound] = await tdb.select().from(outboundMessages);
    expect(mockedSendMail.mock.calls[0][0].headers).toEqual({
      "List-Unsubscribe": `<${getUnsubLink(contact.unsubscribeToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-SES-MESSAGE-TAGS": `sendlit_message_id=${outbound.messageId}`,
    });
    expect(outbound.providerMessageId).toBe("0100018f-ses-id-000000");
  });

  it("pauses on corrupted marketing content without a final managed footer, before transport", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1", subject: "Broken" }],
    });
    await tdb
      .update(sequenceEmails)
      .set({
        content: {
          style: {},
          meta: {},
          content: [
            {
              blockType: "text",
              settings: { content: "No footer" },
            },
          ],
        },
      })
      .where(eq(sequenceEmails.id, emailRows[0].id));
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);
    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(0);
    const [paused] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceRow.id));
    expect(paused.status).toBe("paused");
    expect((paused.report as any).autoPause).toMatchObject({
      reason: "render_error",
      error: "footer_required",
    });
  });

  it("skips a suppressed recipient without sending or recording a delivery", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1", subject: "First" }],
    });
    await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: contact.email,
      reason: "complaint",
      actorType: "system",
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    expect(mockedSendMail).not.toHaveBeenCalled();
    const deliveries = await tdb
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.contactId, contact.id));
    expect(deliveries).toHaveLength(0);
    // Treated as handled (not retried) — the sequence still advances.
    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after).toBeUndefined();
  });

  it("applies the email's on-send tag action to the contact", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    await tdb
      .update(contacts)
      .set({ tags: ["existing"] })
      .where(eq(contacts.id, contact.id));
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [
        {
          emailId: "email_e1",
          actionType: "tag:add",
          actionData: { tag: "bol" },
        },
        {
          emailId: "email_e2",
          actionType: "tag:remove",
          actionData: { tag: "existing" },
          delayInMillis: 0,
        },
      ],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);
    let [after] = await tdb.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(after.tags).toEqual(["existing", "bol"]);

    await tdb
      .update(ongoingSequences)
      .set({ nextEmailScheduledTime: Date.now() - 1000 })
      .where(eq(ongoingSequences.id, row.id));
    await processOngoingSequence(row.id);
    [after] = await tdb.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(after.tags).toEqual(["bol"]);
  });

  it("asks a SendGrid ESP not to track what SendLit already tracks", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      espConfig: { provider: "sendgrid" },
    });
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    const { headers } = mockedSendMail.mock.calls[0][0];
    expect(JSON.parse(headers?.["X-SMTPAPI"] ?? "{}").filters).toMatchObject({
      clicktrack: { settings: { enable: 0 } },
      opentrack: { settings: { enable: 0 } },
    });
    expect(headers?.["List-Unsubscribe"]).toContain("/unsubscribe/");
  });

  it("sends with the ESP's Reply-To", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      espConfig: { replyTo: "support@example.com" },
    });
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    expect(mockedSendMail.mock.calls[0][0].replyTo).toBe("support@example.com");
  });

  it("keeps each send's web version at what was sent when the email is edited mid-sequence", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const viewPath = (html: string) =>
      new URL(html.match(/href="(https:\/\/sendlit\.test\/view\/[^"]+)"/)?.[1] ?? "")
        .pathname;
    const webView = express().use(webViewRoutes);

    const before = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    await processOngoingSequence(before.id);
    await tdb
      .update(sequenceEmails)
      .set({ content: emailContent({ text: "Edited for later contacts" }) })
      .where(eq(sequenceEmails.id, emailRows[0].id));
    const after = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    await processOngoingSequence(after.id);

    const [earlier, later] = mockedSendMail.mock.calls.map(([mail]) => mail.html);
    expect(earlier).toContain("Hello Ada Lovelace!");
    expect(later).toContain("Edited for later contacts");
    const earlierPage = await requestApp(webView, viewPath(earlier));
    expect(earlierPage.body).toContain("Hello Ada Lovelace!");
    expect(earlierPage.body).not.toContain("Edited for later contacts");
    const laterPage = await requestApp(webView, viewPath(later));
    expect(laterPage.body).toContain("Edited for later contacts");

    const versions = await tdb
      .select()
      .from(emailContentVersions)
      .where(eq(emailContentVersions.sequenceEmailId, emailRows[0].id));
    expect(versions).toHaveLength(2);
    const deliveries = await tdb
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.emailId, emailRows[0].id));
    expect(new Set(deliveries.map((d) => d.contentVersionId))).toEqual(
      new Set(versions.map((v) => v.id)),
    );
  });

  it("puts every link on the team's verified tracking domain", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      settings: {
        trackingDomain: "track.example.com",
        trackingDomainStatus: "verified",
      },
    });
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    const { html, headers } = mockedSendMail.mock.calls[0][0];
    expect(html).toContain("https://track.example.com/track/open?d=");
    expect(html).toContain("https://track.example.com/track/click?d=");
    expect(html).toMatch(/href="https:\/\/track\.example\.com\/view\/[^"]+"/);
    expect(html).toContain(
      `https://track.example.com/unsubscribe/${contact.unsubscribeToken}`,
    );
    expect(html).not.toContain("sendlit.test/");
    expect(headers?.["List-Unsubscribe"]).toBe(
      `<https://track.example.com/unsubscribe/${contact.unsubscribeToken}>`,
    );
  });

  it("renders merge tags, the tracking pixel, and click-tracked links", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    const { html } = mockedSendMail.mock.calls[0][0];
    expect(html).toContain("Hello Ada Lovelace!");
    expect(html).toContain(`/unsubscribe/${contact.unsubscribeToken}`);
    expect(html).toContain("https://sendlit.test/track/open?d=");
    expect(html).toContain("https://sendlit.test/track/click?d=");
    expect(html).not.toContain("/api/track/");
    // The original destination must only survive inside the signed token.
    expect(html).not.toContain('href="https://example.com/offer"');
    // The footer links the web version directly, not through click tracking.
    expect(html).toMatch(/href="https:\/\/sendlit\.test\/view\/[^"]+"/);
  });

  it("does not send twice when invoked again after the send (duplicate-job regression)", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [
        { emailId: "email_e1", delayInMillis: 0 },
        { emailId: "email_e2", delayInMillis: 3_600_000 },
      ],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);
    // A stale duplicate BullMQ job arrives right after the schedule advanced:
    // before the dueness guard this would send "email_e2" immediately.
    await processOngoingSequence(row.id);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it("atomically claims a due row so concurrent workers send only once", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    let releaseSend!: () => void;
    mockedSendMail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSend = () => resolve({ messageId: null, providerResponse: null });
        }),
    );

    const first = processOngoingSequence(row.id);
    await waitFor(() => expect(mockedSendMail).toHaveBeenCalledTimes(1));
    const concurrent = processOngoingSequence(row.id);
    await concurrent;

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    releaseSend();
    await first;
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired worker claim but leaves a live claim alone", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    await tdb
      .update(ongoingSequences)
      .set({ processingStartedAt: new Date() })
      .where(eq(ongoingSequences.id, row.id));

    await processOngoingSequence(row.id);
    expect(mockedSendMail).not.toHaveBeenCalled();

    await tdb
      .update(ongoingSequences)
      .set({ processingStartedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(ongoingSequences.id, row.id));
    await processOngoingSequence(row.id);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it("completes a broadcast: deletes the row and marks the sequence sent", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      type: "broadcast",
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    const remaining = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(remaining).toHaveLength(0);

    const [seqAfter] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceRow.id));
    expect(seqAfter.status).toBe("completed");
    expect((seqAfter.report as any).broadcast.sentAt).toBeTypeOf("number");
  });

  it("sends through a user ESP when platform quota is exhausted", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await processOngoingSequence(row.id);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    const remaining = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(remaining).toHaveLength(0);
  });

  it("fails closed and never falls back when the pinned ESP disappears", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    // Pins are immutable and historical ESPs are retained. Simulate a
    // retired source after activation; the worker must fail closed rather
    // than resolving a current default.
    await tdb
      .update(espConfigs)
      .set({ status: "retired" })
      .where(eq(espConfigs.teamId, team.id));
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await expect(processOngoingSequence(row.id)).rejects.toThrow(
      "delivery_source_unavailable",
    );

    expect(mockedSendMail).not.toHaveBeenCalled();
    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    // The ESP-existence guard throws before the retry-tracking path, so
    // the row is left untouched rather than treated as a transient send
    // failure — never silently retried through a different transport.
    expect(after.retryCount).toBe(0);
  });

  it("cascade-deletes the ongoing_sequences row when its contact is deleted", async () => {
    // `ongoing_sequences.contact_id` is now a real `ON DELETE CASCADE` FK
    // to `contacts.id`, so it's no longer possible to construct a row
    // whose contact "no longer exists" — the FK makes that state
    // structurally unreachable. Instead assert the DB-level cascade
    // itself: deleting the contact removes the ongoing_sequences row
    // without any app code (`processOngoingSequence`) running at all.
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });

    await tdb.delete(contacts).where(eq(contacts.id, contact.id));

    const remaining = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(remaining).toHaveLength(0);
    // Not a completed delivery — the broadcast/sequence must not be marked sent.
    const [seqAfter] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceRow.id));
    expect(seqAfter.status).toBe("active");
  });

  it("reschedules a rate-limited send without counting a failed attempt", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    mockedSendMail.mockRejectedValueOnce(new SendDeferredError(60_000));
    const before = Date.now();

    await expect(processOngoingSequence(row.id)).resolves.toBeUndefined();

    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after.retryCount).toBe(0);
    expect(after.processingStartedAt).toBeNull();
    expect(after.nextEmailScheduledTime).toBeGreaterThanOrEqual(before + 60_000);
    expect(after.sentEmailIds).toEqual([]);
  });

  it("waits for an exhausted organization quota instead of failing", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    mockedSendMail.mockRejectedValueOnce(
      Object.assign(new Error("organization_team_quota_exhausted"), {
        retryAfter: 600,
      }),
    );

    await expect(processOngoingSequence(row.id)).resolves.toBeUndefined();

    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after.retryCount).toBe(0);
    expect(after.nextEmailScheduledTime).toBeGreaterThan(Date.now() + 590_000);
  });

  it("increments retryCount and keeps the row on a send failure below the bounce limit", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
    });
    mockedSendMail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(processOngoingSequence(row.id)).rejects.toThrow("smtp down");

    const [after] = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(after.retryCount).toBe(1);
    expect(after.sentEmailIds).toEqual([]);
    const deliveries = await tdb.select().from(emailDeliveries);
    expect(deliveries).toHaveLength(0);
  });

  it("records the failure on the sequence report and drops the row at the bounce limit", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    // sequenceBounceLimit defaults to 3: this attempt is the third failure.
    const row = await seedOngoingSequence(tdb, {
      teamId: team.id,
      sequenceId: sequenceRow.id,
      contactId: contact.id,
      retryCount: 2,
    });
    mockedSendMail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(processOngoingSequence(row.id)).rejects.toThrow("smtp down");

    const remaining = await tdb
      .select()
      .from(ongoingSequences)
      .where(eq(ongoingSequences.id, row.id));
    expect(remaining).toHaveLength(0);

    const [seqAfter] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceRow.id));
    expect((seqAfter.report as any).sequence.failed).toContain(contact.contactId);
  });
});
