import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

const mocks = vi.hoisted(() => ({
    fireEvent: vi.fn(async () => undefined),
}));
vi.mock("../automation/fire-event", () => ({ fireEvent: mocks.fireEvent }));

import { db } from "../db/client";
import { contacts, emailDeliveries } from "../db/schema";
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
                contactId: first.id,
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
                subscribed: false,
            }),
        ).toMatchObject({
            name: "Ada Updated",
            subscribed: false,
        });
    });

    it("applies contact filter builder conditions to contact lists", async () => {
        const { team, contact } = await seedTeamAndContact(tdb, {
            contact: {
                email: "ada@example.com",
                name: "Ada",
                tags: ["vip"],
                subscribed: true,
                createdAt: new Date("2026-01-10T08:00:00Z"),
            },
        });
        const [grace] = await tdb
            .insert(contacts)
            .values([
                {
                    teamId: team.id,
                    email: "grace@test.com",
                    name: "Grace",
                    tags: ["trial"],
                    subscribed: false,
                    unsubscribeToken: "token-grace",
                    createdAt: new Date("2026-01-10T18:00:00Z"),
                },
                {
                    teamId: team.id,
                    email: "linus@example.com",
                    name: "Linus",
                    tags: [],
                    subscribed: true,
                    unsubscribeToken: "token-linus",
                    createdAt: new Date("2026-01-11T00:00:00Z"),
                },
            ])
            .returning();
        const graceContactId = grace.contactId;

        expect(
            (
                await listContacts({
                    teamId: team.id,
                    filter: {
                        aggregator: "and",
                        filters: [
                            {
                                name: "email",
                                condition: "not_contains",
                                value: "@test.com",
                            },
                            {
                                name: "subscription",
                                condition: "is",
                                value: "subscribed",
                            },
                        ],
                    },
                })
            ).map((row) => row.email),
        ).toEqual(["ada@example.com", "linus@example.com"]);

        expect(
            (
                await listContacts({
                    teamId: team.id,
                    filter: {
                        aggregator: "or",
                        filters: [
                            { name: "tag", condition: "is", value: "trial" },
                            {
                                name: "signedUp",
                                condition: "on",
                                value: String(new Date("2026-01-10").getTime()),
                            },
                        ],
                    },
                })
            ).map((row) => row.contactId),
        ).toEqual([contact.contactId, graceContactId]);

        await expect(
            listContacts({
                teamId: team.id,
                filter: {
                    aggregator: "and",
                    filters: [
                        {
                            name: "product",
                            condition: "has",
                            value: "course-1",
                        },
                    ],
                } as any,
            }),
        ).resolves.toEqual([]);
    });

    it("indexes custom field scalars and arrays for generic filters", async () => {
        const { team, contact } = await seedTeamAndContact(tdb, {
            contact: {
                email: "ada@example.com",
                customFields: {
                    plan: "pro",
                    score: 42,
                    activeCustomer: true,
                    "courselit.products": ["course_123", "course_456"],
                    lastActiveAt: "2026-01-10T08:00:00.000Z",
                },
            },
        });
        await updateContact(team.id, contact.contactId, {
            customFields: contact.customFields,
        });
        const [basicRow] = await tdb
            .insert(contacts)
            .values({
                teamId: team.id,
                email: "basic@example.com",
                unsubscribeToken: "token-basic",
                customFields: {
                    plan: "free",
                    score: 3,
                    activeCustomer: false,
                    "courselit.products": ["course_999"],
                    lastActiveAt: "2026-01-01T08:00:00.000Z",
                },
            })
            .returning();
        const basicContactId = basicRow.contactId;

        // Direct inserts bypass query helpers, so use updateContact to build
        // the custom-field index for the second row.
        await updateContact(team.id, basicContactId, {
            customFields: {
                plan: "free",
                score: 3,
                activeCustomer: false,
                "courselit.products": ["course_999"],
                lastActiveAt: "2026-01-01T08:00:00.000Z",
            },
        });

        expect(
            (
                await listContacts({
                    teamId: team.id,
                    filter: {
                        aggregator: "and",
                        filters: [
                            {
                                name: "customField",
                                key: "courselit.products",
                                condition: "has",
                                value: "course_123",
                            },
                            {
                                name: "customField",
                                key: "score",
                                condition: "is",
                                value: "42",
                            },
                            {
                                name: "customField",
                                key: "activeCustomer",
                                condition: "is",
                                value: "true",
                            },
                        ],
                    },
                })
            ).map((row) => row.contactId),
        ).toEqual([contact.contactId]);

        expect(
            (
                await listContacts({
                    teamId: team.id,
                    filter: {
                        aggregator: "and",
                        filters: [
                            {
                                name: "customField",
                                key: "lastActiveAt",
                                condition: "after",
                                value: "2026-01-05",
                            },
                        ],
                    },
                })
            ).map((row) => row.contactId),
        ).toEqual([contact.contactId]);
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
            await addTagToContact(team.id, crypto.randomUUID(), "ghost"),
        ).toBeNull();
        expect(mocks.fireEvent).toHaveBeenCalledTimes(3);
    });

    it("returns a contact delivery history newest first", async () => {
        const { team, contact } = await seedTeamAndContact(tdb);
        const { sequenceRow, emailRows } = await seedSequence(tdb, {
            teamId: team.id,
            emails: [
                { emailId: "email_first", subject: "First" },
                { emailId: "email_second", subject: "Second" },
            ],
        });
        const [older, newer] = emailRows;

        await tdb.insert(emailDeliveries).values([
            {
                teamId: team.id,
                sequenceId: sequenceRow.id,
                contactId: contact.id,
                emailId: older.id,
                createdAt: new Date("2026-01-01T00:00:00Z"),
            },
            {
                teamId: team.id,
                sequenceId: sequenceRow.id,
                contactId: contact.id,
                emailId: newer.id,
                createdAt: new Date("2026-01-02T00:00:00Z"),
            },
        ]);

        expect(
            (await getDeliveriesByContact(team.id, contact.id)).map(
                (row) => row.emailId,
            ),
        ).toEqual([newer.emailId, older.emailId]);
    });
});
