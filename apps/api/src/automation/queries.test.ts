import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { ongoingSequences } from "../db/schema";
import { truncateAll, seedTeamAndContact, type TestDb } from "../test/db";
import {
    countOngoingSequencesForSequence,
    enrollContactsInOngoingSequence,
    getDueOngoingSequences,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("enrollContactsInOngoingSequence", () => {
    it("is idempotent per (sequence, contact) — re-enrolling is a no-op", async () => {
        const { team } = await seedTeamAndContact(tdb);

        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: "seq-1",
            contactIds: ["c1", "c2"],
        });
        // Duplicate enrollment (e.g. a rule re-fired or a crash-retry).
        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: "seq-1",
            contactIds: ["c1"],
        });

        const rows = await tdb
            .select()
            .from(ongoingSequences)
            .where(eq(ongoingSequences.sequenceId, "seq-1"));
        expect(rows).toHaveLength(2);
        // Same contact may be enrolled in a different sequence, though.
        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: "seq-2",
            contactIds: ["c1"],
        });
        expect(await countOngoingSequencesForSequence("seq-2")).toBe(1);
    });
});

describe("getDueOngoingSequences", () => {
    it("returns only rows that are due and under the bounce limit", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const base = {
            teamId: team.id,
            sequenceId: "seq-1",
        };
        await tdb.insert(ongoingSequences).values([
            {
                ...base,
                contactId: "due",
                nextEmailScheduledTime: Date.now() - 1000,
            },
            {
                ...base,
                contactId: "future",
                nextEmailScheduledTime: Date.now() + 60_000,
            },
            {
                ...base,
                contactId: "bounced-out",
                nextEmailScheduledTime: Date.now() - 1000,
                retryCount: 3, // sequenceBounceLimit default
            },
        ]);

        const due = await getDueOngoingSequences();
        expect(due.map((r) => r.contactId)).toEqual(["due"]);
    });
});

describe("countOngoingSequencesForSequence", () => {
    it("counts rows per sequence", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await enrollContactsInOngoingSequence({
            teamId: team.id,
            sequenceId: "seq-1",
            contactIds: ["c1", "c2", "c3"],
        });

        expect(await countOngoingSequencesForSequence("seq-1")).toBe(3);
        expect(await countOngoingSequencesForSequence("seq-none")).toBe(0);
    });
});
