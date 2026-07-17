import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { contacts, ongoingSequences } from "../db/schema";
import { truncateAll, seedTeamAndContact, type TestDb } from "../test/db";
import { seedSequence } from "../test/fixtures";
import {
    countOngoingSequencesForSequence,
    enrollContactsInOngoingSequence,
    getDueOngoingSequences,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
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

async function seedTwoSequences(teamId: string) {
    const one = await seedSequence(tdb, {
        teamId,
        emails: [{ emailId: "email_e1" }],
    });
    const two = await seedSequence(tdb, {
        teamId,
        emails: [{ emailId: "email_e1" }],
    });
    return { one: one.sequenceRow, two: two.sequenceRow };
}

describe("enrollContactsInOngoingSequence", () => {
    it("is idempotent per (sequence, contact) — re-enrolling is a no-op", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { one: seqOne, two: seqTwo } = await seedTwoSequences(team.id);
        const firstContact = await seedContact(team.id);
        const secondContact = await seedContact(team.id);

        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: seqOne.id,
            contactIds: [firstContact.id, secondContact.id],
        });
        // Duplicate enrollment (e.g. a rule re-fired or a crash-retry).
        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: seqOne.id,
            contactIds: [firstContact.id],
        });

        const rows = await tdb
            .select()
            .from(ongoingSequences)
            .where(eq(ongoingSequences.sequenceId, seqOne.id));
        expect(rows).toHaveLength(2);
        // Same contact may be enrolled in a different sequence, though.
        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: seqTwo.id,
            contactIds: [firstContact.id],
        });
        expect(await countOngoingSequencesForSequence(seqTwo.id)).toBe(1);
    });
});

describe("getDueOngoingSequences", () => {
    it("returns only rows that are due and under the bounce limit", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { sequenceRow } = await seedSequence(tdb, {
            teamId: team.id,
            emails: [{ emailId: "email_e1" }],
        });
        const base = {
            teamId: team.id,
            sequenceId: sequenceRow.id,
        };
        const dueContact = await seedContact(team.id);
        const futureContact = await seedContact(team.id);
        const bouncedContact = await seedContact(team.id);
        const claimedContact = await seedContact(team.id);
        const staleClaimContact = await seedContact(team.id);
        await tdb.insert(ongoingSequences).values([
            {
                ...base,
                contactId: dueContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
            },
            {
                ...base,
                contactId: futureContact.id,
                nextEmailScheduledTime: Date.now() + 60_000,
            },
            {
                ...base,
                contactId: bouncedContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
                retryCount: 3, // sequenceBounceLimit default
            },
            {
                ...base,
                contactId: claimedContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
                processingStartedAt: new Date(),
            },
            {
                ...base,
                contactId: staleClaimContact.id,
                nextEmailScheduledTime: Date.now() - 1000,
                processingStartedAt: new Date(Date.now() - 11 * 60_000),
            },
        ]);

        const due = await getDueOngoingSequences();
        expect(due.map((r) => r.contactId).sort()).toEqual(
            [dueContact.id, staleClaimContact.id].sort(),
        );
    });
});

describe("countOngoingSequencesForSequence", () => {
    it("counts rows per sequence", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { one: seqOne, two: seqTwo } = await seedTwoSequences(team.id);
        const contactRows = await Promise.all([
            seedContact(team.id),
            seedContact(team.id),
            seedContact(team.id),
        ]);

        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: seqOne.id,
            contactIds: contactRows.map((c) => c.id),
        });

        expect(await countOngoingSequencesForSequence(seqOne.id)).toBe(3);
        expect(await countOngoingSequencesForSequence(seqTwo.id)).toBe(0);
    });
});
