import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../mail/send", () => ({
    sendMail: vi
        .fn()
        .mockResolvedValue({ messageId: null, providerResponse: null }),
}));

import { db } from "../db/client";
import { sendMail } from "../mail/send";
import {
    accounts,
    contacts,
    emailDeliveries,
    ongoingSequences,
    sequences,
} from "../db/schema";
import { truncateAll, seedTeamAndContact, type TestDb } from "../test/db";
import { seedSequence, seedOngoingSequence } from "../test/fixtures";
import {
    getNextPublishedEmail,
    processOngoingSequence,
} from "./process-ongoing-sequence";
import { addOrStrengthenSuppression } from "../delivery-feedback/suppression-queries";

const tdb = db as unknown as TestDb;
const mockedSendMail = vi.mocked(sendMail);

beforeEach(async () => {
    await truncateAll(tdb);
    mockedSendMail.mockClear();
    mockedSendMail.mockResolvedValue({
        messageId: null,
        providerResponse: null,
    });
});

describe("getNextPublishedEmail", () => {
    const email = (emailId: string, published = true) =>
        ({ emailId, published }) as any;

    it("returns emails in emailsOrder, skipping already-sent ones", () => {
        const emails = [email("b"), email("a")];
        expect(
            getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: [] })
                ?.emailId,
        ).toBe("a");
        expect(
            getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: ["a"] })
                ?.emailId,
        ).toBe("b");
    });

    it("skips unpublished emails", () => {
        const emails = [email("a", false), email("b")];
        expect(
            getNextPublishedEmail(["a", "b"], emails, { sentEmailIds: [] })
                ?.emailId,
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
        const { account, team, contact } = await seedTeamAndContact(tdb);
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
        const { account, team, contact } = await seedTeamAndContact(tdb);
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

        const [accountAfter] = await tdb
            .select()
            .from(accounts)
            .where(eq(accounts.id, account.id));
        expect(accountAfter.dailyMailCount).toBe(0);
        expect(accountAfter.monthlyMailCount).toBe(0);
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
        let [after] = await tdb
            .select()
            .from(contacts)
            .where(eq(contacts.id, contact.id));
        expect(after.tags).toEqual(["existing", "bol"]);

        await tdb
            .update(ongoingSequences)
            .set({ nextEmailScheduledTime: Date.now() - 1000 })
            .where(eq(ongoingSequences.id, row.id));
        await processOngoingSequence(row.id);
        [after] = await tdb
            .select()
            .from(contacts)
            .where(eq(contacts.id, contact.id));
        expect(after.tags).toEqual(["bol"]);
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
        expect(html).toContain("https://sendlit.test/api/track/open?d=");
        expect(html).toContain("https://sendlit.test/api/track/click?d=");
        // The original destination must only survive inside the signed token.
        expect(html).not.toContain('href="https://example.com/offer"');
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
                    releaseSend = () =>
                        resolve({ messageId: null, providerResponse: null });
                }),
        );

        const first = processOngoingSequence(row.id);
        await vi.waitFor(() => expect(mockedSendMail).toHaveBeenCalledOnce());
        const concurrent = processOngoingSequence(row.id);
        await concurrent;

        expect(mockedSendMail).toHaveBeenCalledOnce();
        releaseSend();
        await first;
        expect(mockedSendMail).toHaveBeenCalledOnce();
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
        expect(mockedSendMail).toHaveBeenCalledOnce();
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
        const { team, contact } = await seedTeamAndContact(tdb, {
            account: { dailyMailLimit: 5, dailyMailCount: 5 },
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

        expect(mockedSendMail).toHaveBeenCalledOnce();
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
        // The pinned outbox no longer exists (FK `ON DELETE SET NULL` — see
        // `db/schema.ts#sequences.outboxId`), simulating an ESP deleted after
        // the sequence was started, while `deliveryRoute` is still "custom".
        await tdb
            .update(sequences)
            .set({ outboxId: null })
            .where(eq(sequences.id, sequenceRow.id));
        const row = await seedOngoingSequence(tdb, {
            teamId: team.id,
            sequenceId: sequenceRow.id,
            contactId: contact.id,
        });

        await expect(processOngoingSequence(row.id)).rejects.toThrow(
            "Team ESP is not configured.",
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

        await expect(processOngoingSequence(row.id)).rejects.toThrow(
            "smtp down",
        );

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

        await expect(processOngoingSequence(row.id)).rejects.toThrow(
            "smtp down",
        );

        const remaining = await tdb
            .select()
            .from(ongoingSequences)
            .where(eq(ongoingSequences.id, row.id));
        expect(remaining).toHaveLength(0);

        const [seqAfter] = await tdb
            .select()
            .from(sequences)
            .where(eq(sequences.id, sequenceRow.id));
        expect((seqAfter.report as any).sequence.failed).toContain(
            contact.contactId,
        );
    });
});
