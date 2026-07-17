import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    createApiKey,
    deleteApiKey,
    getApiKeyBySecret,
    getApiKeysByTeamId,
} from "./queries";
import { API_KEY_PREFIX } from "./secret";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

describe("api key queries (integration)", () => {
    it("mints a key once, stores only the hash, and resolves by secret", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const { apiKey, secret } = await createApiKey(team.id, "CI");
        expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
        expect(apiKey.keyHash).not.toContain(
            secret.slice(API_KEY_PREFIX.length),
        );
        expect(apiKey.keyPrefix).toBe(secret.slice(0, 12));

        const found = await getApiKeyBySecret(secret);
        expect(found?.id).toBe(apiKey.id);
        expect(await getApiKeyBySecret("sl_live_wrong")).toBeNull();

        expect(await getApiKeysByTeamId(team.id)).toHaveLength(1);

        await deleteApiKey(team.id, apiKey.id);
        expect(await getApiKeysByTeamId(team.id)).toHaveLength(0);
        expect(await getApiKeyBySecret(secret)).toBeNull();
    });

    it("scopes keys to a team", async () => {
        const one = await seedTeamAndContact(tdb);
        const two = await seedTeamAndContact(tdb);

        await createApiKey(one.team.id, "A");
        await createApiKey(two.team.id, "B");

        expect(await getApiKeysByTeamId(one.team.id)).toHaveLength(1);
        expect(await getApiKeysByTeamId(two.team.id)).toHaveLength(1);
    });
});
