import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { rules } from "../db/schema";
import { EventType } from "../config/constants";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { seedSequence } from "../test/fixtures";
import {
    addRule,
    defaultEmailContent,
    removeRule,
    verifyMandatoryTags,
} from "./helpers";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("sequence helpers", () => {
    it("requires unsubscribe and address merge tags", () => {
        expect(() =>
            verifyMandatoryTags(defaultEmailContent.content),
        ).not.toThrow();
        expect(() =>
            verifyMandatoryTags([
                {
                    blockType: "text",
                    settings: { content: "no tags here" },
                },
            ]),
        ).toThrow(/unsubscribe_link/);
    });

    it("adds and removes broadcast schedule rules", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { sequenceRow } = await seedSequence(tdb, {
            teamId: team.id,
            type: "broadcast",
            emails: [{ emailId: "email_helpers1", delayInMillis: 0 }],
        });

        await addRule({
            teamId: team.id,
            sequenceId: sequenceRow.id,
            triggerType: EventType.DATE_OCCURRED,
            eventDateInMillis: Date.now() + 60_000,
        });
        expect(await tdb.select().from(rules)).toHaveLength(1);

        await removeRule({ teamId: team.id, sequenceId: sequenceRow.id });
        expect(await tdb.select().from(rules)).toHaveLength(0);
    });
});
