import { describe, expect, it, mock } from "bun:test";
import { schemaCheckFor } from "@better-auth/core/db/internal";

/*
 * Fails when the Drizzle tables in src/db/schema-core.ts no longer match what
 * SendLit's Better Auth configuration (core, plugins, additional fields)
 * expects. Better Auth runs the same comparison at runtime; `bun run
 * check:drift` runs it in CI so drift is caught before a deploy. PGlite only
 * backs the provider's startup seeding; the comparison itself reads the
 * Drizzle schema definitions.
 */

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { auth } = await import("./better-auth");

describe("Better Auth schema drift", () => {
  it("matches the committed Drizzle auth tables", async () => {
    const context = await auth.$context;
    const check = schemaCheckFor(context.adapter);
    expect(check).toBeDefined();
    await check?.();
  });
});
