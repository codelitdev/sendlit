import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";

/**
 * An in-memory Postgres (PGlite) with the real drizzle migrations applied, so
 * tests exercise actual query semantics — unique indexes, `onConflictDoNothing`,
 * `jsonb_set`, FK cascades — instead of mocked query builders.
 *
 * Use it from a test file by mocking the app's db client module:
 *
 *   vi.mock("../db/client", async () => {
 *       const { makeTestDb } = await import("../test/db");
 *       return { db: await makeTestDb() };
 *   });
 *
 * Every module that imports `db` from `db/client` (queries, team/contacts
 * helpers, the code under test, and the test itself) then shares this instance.
 */
export type TestDb = Awaited<ReturnType<typeof makeTestDb>>;

export async function makeTestDb() {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, {
        // Resolved from cwd: tests always run via vitest, whose root (and
        // worker cwd) is this package (`apps/api`). `import.meta` is not
        // available here because tsc typechecks this package as CJS.
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    return db;
}

/** Deletes all rows from every table, in FK-safe order. Call in `beforeEach`
 * so tests within a file (which share one PGlite instance) stay independent. */
export async function truncateAll(db: Awaited<ReturnType<typeof makeTestDb>>) {
    // teams cascades to contacts, sequences, rules, ongoing_sequences,
    // email_deliveries, team_members, api_keys; sequences cascades to
    // sequence_emails.
    await db.delete(schema.teams);
    await db.delete(schema.accounts);
}

/**
 * Seeds the minimal object graph most automation tests need: an account, a
 * team (default quota), and one contact. Individual tests add sequences /
 * emails / ongoing rows on top.
 */
export async function seedTeamAndContact(
    db: Awaited<ReturnType<typeof makeTestDb>>,
    overrides: {
        account?: Partial<typeof schema.accounts.$inferInsert>;
        team?: Partial<typeof schema.teams.$inferInsert>;
        contact?: Partial<typeof schema.contacts.$inferInsert>;
        espConfig?: Partial<typeof schema.espConfigs.$inferInsert>;
        settings?: Partial<typeof schema.settings.$inferInsert>;
    } = {},
) {
    const [account] = await db
        .insert(schema.accounts)
        .values({
            email: `owner-${crypto.randomUUID()}@example.com`,
            ...overrides.account,
        })
        .returning();

    const [team] = await db
        .insert(schema.teams)
        .values({
            name: "Test team",
            ownerAccountId: account.id,
            ...overrides.team,
        })
        .returning();

    await db.insert(schema.espConfigs).values({
        teamId: team.id,
        name: "Default ESP",
        isDefault: true,
        host: "smtp.example.com",
        fromName: "Test Sender",
        fromEmail: "sender@example.com",
        ...overrides.espConfig,
    });

    await db.insert(schema.settings).values({
        teamId: team.id,
        mailingAddress: "1 Test St, Testville",
        ...overrides.settings,
    });

    const [contact] = await db
        .insert(schema.contacts)
        .values({
            teamId: team.id,
            email: `reader-${crypto.randomUUID()}@example.com`,
            name: "Ada Lovelace",
            unsubscribeToken: crypto.randomUUID(),
            tags: ["vip"],
            ...overrides.contact,
        })
        .returning();

    return { account, team, contact };
}
