import { createHash } from "node:crypto";

/** JSON with sorted keys: Postgres `jsonb` doesn't keep key order, so the
 * same content read back must hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Fingerprint of an email's subject and content: a scan verdict holds
 * only for it, and stored versions are deduplicated by it. */
export function contentHash(subject: string, content: unknown): string {
  return createHash("sha256").update(canonicalJson({ subject, content })).digest("hex");
}
