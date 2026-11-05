import { readFile, writeFile } from "node:fs/promises";
import { openApiDocument } from "@sendlit/api-contract/openapi";

/**
 * Writes the OpenAPI document generated from the ts-rest contract to
 * `apps/api/openapi.json`, the spec FrontLit publishes as the API reference.
 * `--check` fails instead of writing when the committed file is stale; CI runs it.
 *
 *   bun --filter @sendlit/api openapi:generate
 *   bun --filter @sendlit/api openapi:check
 */
const TARGET = new URL("../openapi.json", import.meta.url);
const expected = `${JSON.stringify(openApiDocument, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(TARGET, "utf8").catch(() => "");
  if (current !== expected) {
    console.error(
      "apps/api/openapi.json is out of date with the API contract. Run `bun --filter @sendlit/api openapi:generate` and commit the result.",
    );
    process.exit(1);
  }
  console.log("apps/api/openapi.json is up to date.");
} else {
  await writeFile(TARGET, expected);
  console.log("Wrote apps/api/openapi.json.");
}
