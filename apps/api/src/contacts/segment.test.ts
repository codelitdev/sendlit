import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { contacts } from "../db/schema";
import { UserFilter } from "../config/constants";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { buildContactFilterCondition } from "./segment";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("contact segment filters (integration)", () => {
    it("filters by tag, email, and subscription with and/or aggregators", async () => {
        const { team } = await seedTeamAndContact(tdb, {
            contact: {
                email: "vip@example.com",
                tags: ["vip", "beta"],
                subscribed: true,
            },
        });
        await tdb.insert(contacts).values({
            teamId: team.id,
            email: "plain@example.com",
            name: "Plain",
            unsubscribeToken: crypto.randomUUID(),
            tags: ["beta"],
            subscribed: false,
        });

        async function match(
            filter: Parameters<typeof buildContactFilterCondition>[0],
        ) {
            const condition = buildContactFilterCondition(filter);
            const rows = await tdb
                .select({ email: contacts.email })
                .from(contacts)
                .where(and(eq(contacts.teamId, team.id), condition));
            return rows.map((r) => r.email).sort();
        }

        expect(
            await match({
                aggregator: "and",
                filters: [
                    {
                        name: UserFilter.TAG,
                        condition: "is",
                        value: "vip",
                    },
                ],
            }),
        ).toEqual(["vip@example.com"]);

        expect(
            await match({
                aggregator: "and",
                filters: [
                    {
                        name: UserFilter.EMAIL,
                        condition: "contains",
                        value: "plain",
                    },
                    {
                        name: UserFilter.SUBSCRIPTION,
                        condition: "is",
                        value: "unsubscribed",
                    },
                ],
            }),
        ).toEqual(["plain@example.com"]);

        expect(
            await match({
                aggregator: "or",
                filters: [
                    {
                        name: UserFilter.TAG,
                        condition: "is",
                        value: "vip",
                    },
                    {
                        name: UserFilter.EMAIL,
                        condition: "is",
                        value: "plain@example.com",
                    },
                ],
            }),
        ).toEqual(["plain@example.com", "vip@example.com"]);

        // Unknown/invalid filter short-circuits to no matches.
        expect(
            await match({
                aggregator: "and",
                filters: [
                    {
                        name: UserFilter.TAG,
                        condition: "is",
                        // missing value
                    },
                ],
            }),
        ).toEqual([]);
    });
});
