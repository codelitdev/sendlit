import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../mail/sequence-queue", () => ({
    default: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { db } from "../db/client";
import sequenceQueue from "../mail/sequence-queue";
import { contacts, ongoingSequences } from "../db/schema";
import { truncateAll, seedTeamAndContact, type TestDb } from "../test/db";
import { seedSequence } from "../test/fixtures";
import { enqueueDueOngoingSequences } from "./process-ongoing-sequences";

const tdb = db as unknown as TestDb;
const mockedAdd = vi.mocked(sequenceQueue.add);

beforeEach(async () => {
    await truncateAll(tdb);
    mockedAdd.mockClear();
    mockedAdd.mockResolvedValue(undefined as any);
});

async function seedContact(teamId: string) {
    const [row] = await tdb
        .insert(contacts)
        .values({
            teamId,
            email: `reader-${crypto.randomUUID()}@example.com`,
            unsubscribeToken: crypto.randomUUID(),
        })
        .returning();
    return row;
}

describe("enqueueDueOngoingSequences", () => {
    it("enqueues due rows keyed by row id so BullMQ can dedup duplicates", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { sequenceRow } = await seedSequence(tdb, {
            teamId: team.id,
            emails: [{ emailId: "email_e1" }],
        });
        const firstContact = await seedContact(team.id);
        const secondContact = await seedContact(team.id);
        const notDueContact = await seedContact(team.id);
        const rows = await tdb
            .insert(ongoingSequences)
            .values([
                {
                    teamId: team.id,
                    sequenceId: sequenceRow.id,
                    contactId: firstContact.id,
                    nextEmailScheduledTime: Date.now() - 1000,
                },
                {
                    teamId: team.id,
                    sequenceId: sequenceRow.id,
                    contactId: secondContact.id,
                    nextEmailScheduledTime: Date.now() - 1000,
                },
                {
                    teamId: team.id,
                    sequenceId: sequenceRow.id,
                    contactId: notDueContact.id,
                    nextEmailScheduledTime: Date.now() + 60_000,
                },
            ])
            .returning();

        await enqueueDueOngoingSequences();

        const dueIds = rows
            .filter((r) => r.contactId !== notDueContact.id)
            .map((r) => r.id);
        expect(mockedAdd).toHaveBeenCalledTimes(2);
        for (const id of dueIds) {
            expect(mockedAdd).toHaveBeenCalledWith(
                "sequence",
                { ongoingSequenceId: id },
                { jobId: id },
            );
        }
    });

    it("keeps enqueueing after one row's enqueue fails", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { sequenceRow } = await seedSequence(tdb, {
            teamId: team.id,
            emails: [{ emailId: "email_e1" }],
        });
        const firstContact = await seedContact(team.id);
        const secondContact = await seedContact(team.id);
        await tdb.insert(ongoingSequences).values([
            {
                teamId: team.id,
                sequenceId: sequenceRow.id,
                contactId: firstContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
            },
            {
                teamId: team.id,
                sequenceId: sequenceRow.id,
                contactId: secondContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
            },
        ]);
        mockedAdd.mockRejectedValueOnce(new Error("redis hiccup"));

        await expect(enqueueDueOngoingSequences()).resolves.toBeUndefined();
        expect(mockedAdd).toHaveBeenCalledTimes(2);
    });
});
