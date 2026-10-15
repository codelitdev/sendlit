import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Secrets `checkConfig` in `index.ts` refuses to boot without. The Compose
// self-host path builds `DB_CONNECTION_STRING` itself, so it is not listed.
// Keep in sync when `checkConfig` gains a new required variable.
const REQUIRED_SECRETS = [
    "BETTER_AUTH_SECRET",
    "PIXEL_SIGNING_SECRET",
    "ESP_CREDENTIALS_ENCRYPTION_KEY",
    "SUPPRESSION_HASH_KEY",
];

// Tests run with this package (`apps/api`) as cwd; see `test/db.ts`.
const repoRoot = path.resolve(process.cwd(), "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

describe("self-host configuration", () => {
    const envExample = read(".env.example");
    const compose = read("docker-compose.yml");

    it.each(REQUIRED_SECRETS)("lists %s in the root .env.example", (name) => {
        expect(envExample).toMatch(new RegExp(`^${name}=`, "m"));
    });

    it.each(REQUIRED_SECRETS)(
        "makes docker compose fail fast without %s",
        (name) => {
            expect(compose).toContain(
                `${name}: \${${name}:?Set ${name} in .env}`,
            );
        },
    );
});
