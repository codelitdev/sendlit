import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

const mocks = vi.hoisted(() => ({
    fireEvent: vi.fn(async () => undefined),
}));
vi.mock("../automation/fire-event", () => ({ fireEvent: mocks.fireEvent }));

import { db } from "../db/client";
import { emailDeliveries } from "../db/schema";
import { EventType } from "../config/constants";
import {
    addTagToContact,
    createContact,
    findContactByEmail,
    getDeliveriesByContact,
    listContacts,
    removeTagFromContact,
    updateContact,
} from "./queries";
import { seedSequence } from "../test/fixtures";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    mocks.fireEvent.mockClear();
    await truncateAll(tdb);
});

describe("contact queries", () => {
    it("normalizes emails and treats repeated creates as find-or-create", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const first = await createContact({
            teamId: team.id,
            email: "  ADA@Example.COM ",
            name: "Ada",
        });
        const second = await createContact({
            teamId: team.id,
            email: "ada@example.com",
            name: "Changed",
        });

        expect(second.id).toBe(first.id);
        expect(second.email).toBe("ada@example.com");
        expect(second.name).toBe("Ada");
        expect(await findContactByEmail(team.id, " ADA@example.COM ")).toEqual(
            expect.objectContaining({ id: first.id }),
        );
        expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
        expect(mocks.fireEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: team.id,
                event: EventType.SUBSCRIBER_ADDED,
                contactId: first.contactId,
            }),
        );
    });

    it("keeps list/search/update scoped to a team", async () => {
        const one = await seedTeamAndContact(tdb, {
            contact: { email: "ada@example.com", name: "Ada" },
        });
        const two = await seedTeamAndContact(tdb, {
            contact: { email: "ada@example.com", name: "Other Ada" },
        });

        expect(
            await listContacts({ teamId: one.team.id, searchText: "ada" }),
        ).toHaveLength(1);
        expect(
            await updateContact(two.team.id, one.contact.contactId, {
                name: "Wrong tenant",
            }),
        ).toBeNull();
        expect(
            await updateContact(one.team.id, one.contact.contactId, {
                name: "Ada Updated",
                subscribedToUpdates: false,
            }),
        ).toMatchObject({
            name: "Ada Updated",
            subscribedToUpdates: false,
        });
    });

    it("adds/removes tags idempotently and emits tag events only on updates", async () => {
        const { team, contact } = await seedTeamAndContact(tdb, {
            contact: { tags: ["vip"] },
        });

        const tagged = await addTagToContact(team.id, contact.contactId, "vip");
        expect(tagged?.tags).toEqual(["vip"]);
        const withNewTag = await addTagToContact(
            team.id,
            contact.contactId,
            "trial",
        );
        expect(withNewTag?.tags).toEqual(["vip", "trial"]);
        const removed = await removeTagFromContact(
            team.id,
            contact.contactId,
            "vip",
        );
        expect(removed?.tags).toEqual(["trial"]);

        expect(
            await addTagToContact(team.id, "missing-contact", "ghost"),
        ).toBeNull();
        expect(mocks.fireEvent).toHaveBeenCalledTimes(3);
    });

    it("returns a contact delivery history newest first", async () => {
        const { team, contact } = await seedTeamAndContact(tdb);
        await seedSequence(tdb, {
            teamId: team.id,
            emails: [
                { emailId: "first", subject: "First" },
                { emailId: "second", subject: "Second" },
            ],
        });

        await tdb.insert(emailDeliveries).values([
            {
                teamId: team.id,
                sequenceId: "seq-history",
                contactId: contact.contactId,
                emailId: "older",
                createdAt: new Date("2026-01-01T00:00:00Z"),
            },
            {
                teamId: team.id,
                sequenceId: "seq-history",
                contactId: contact.contactId,
                emailId: "newer",
                createdAt: new Date("2026-01-02T00:00:00Z"),
            },
        ]);

        const [sequence] = await tdb.query.sequences.findMany();
        await tdb
            .update(emailDeliveries)
            .set({ sequenceId: sequence.sequenceId })
            .where(eq(emailDeliveries.sequenceId, "seq-history"));

        expect(
            (await getDeliveriesByContact(team.id, contact.contactId)).map(
                (row) => row.emailId,
            ),
        ).toEqual(["newer", "older"]);
    });
});
