import { readFile, writeFile } from "node:fs/promises";
import { isFreeEmailDomain } from "../src/abuse/email-domains";

/**
 * Refreshes `src/abuse/disposable-domains.txt` from the maintained
 * disposable-email-domains blocklist (CC0). Run weekly by
 * `.github/workflows/update-disposable-domains.yml`, or by hand with
 * `bun --filter @sendlit/api disposable-domains:update`.
 */
const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const TARGET = new URL("../src/abuse/disposable-domains.txt", import.meta.url);
const HEADER = [
  "# Disposable email domains, one per line, from",
  "# https://github.com/disposable-email-domains/disposable-email-domains (CC0 1.0).",
  "# Refreshed by apps/api/scripts/update-disposable-domains.ts; don't edit by hand.",
];
const DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
// Refuse an upstream list that is suspiciously small or shrank a lot at once.
const MIN_DOMAINS = 5_000;
const MAX_SHRINK = 0.2;

function parse(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
}

async function main() {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const domains = [...new Set(parse(await response.text()))].sort();

  const invalid = domains.filter((domain) => !DOMAIN.test(domain));
  if (invalid.length)
    throw new Error(`Invalid domains: ${invalid.slice(0, 10).join(", ")}`);
  const free = domains.filter(isFreeEmailDomain);
  if (free.length) throw new Error(`Lists real mailbox providers: ${free.join(", ")}`);
  if (domains.length < MIN_DOMAINS) {
    throw new Error(`Only ${domains.length} domains; expected at least ${MIN_DOMAINS}`);
  }
  const current = parse(await readFile(TARGET, "utf8").catch(() => ""));
  if (domains.length < current.length * (1 - MAX_SHRINK)) {
    throw new Error(`List shrank from ${current.length} to ${domains.length} domains`);
  }

  await writeFile(TARGET, `${[...HEADER, ...domains].join("\n")}\n`);
  const before = new Set(current);
  const after = new Set(domains);
  const added = domains.filter((domain) => !before.has(domain)).length;
  const removed = current.filter((domain) => !after.has(domain)).length;
  console.log(`${domains.length} domains (+${added}, -${removed})`);
}

await main();
