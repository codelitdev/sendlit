import { promises as dns } from "node:dns";

/** How long one attempt may take. The resolver only re-sends a lost UDP
 * query after 5 seconds and has no working timeout of its own, so each
 * attempt is bounded and a fresh query is sent instead of waiting longer. */
export const DNS_ATTEMPT_TIMEOUT_MS = 6_000;
const DNS_ATTEMPTS = 3;
/** Answers that are definite: the record doesn't exist. Not retried. */
const DEFINITE = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND", "NODATA"]);

function withTimeout<T>(lookup: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns_timeout")), timeoutMs);
    lookup.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * DNS lookups for checks a person re-runs after editing their records (domain
 * authentication, sending-domain verification).
 *
 * - Each lookup uses its own resolver. The shared one caches "no such record"
 *   for up to an hour, so a record added after the first check kept showing
 *   as missing until the API restarted.
 * - Names are queried as absolute (trailing dot), so a miss isn't retried
 *   under the host's search domains.
 * - Each attempt is bounded, and a timeout or server failure is retried
 *   with a new query (up to three attempts), so a lost packet doesn't turn a
 *   record that exists into "not found". "No such record" isn't retried.
 */
export function freshDnsLookups(timeoutMs = DNS_ATTEMPT_TIMEOUT_MS) {
  const absolute = (name: string) => (name.endsWith(".") ? name : `${name}.`);
  async function lookup<T>(query: (resolver: dns.Resolver) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < DNS_ATTEMPTS; attempt++) {
      try {
        return await withTimeout(query(new dns.Resolver()), timeoutMs);
      } catch (error) {
        if (DEFINITE.has((error as { code?: string }).code ?? "")) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
  return {
    resolveTxt: (name: string) =>
      lookup((resolver) => resolver.resolveTxt(absolute(name))),
    resolveMx: (name: string) =>
      lookup((resolver) => resolver.resolveMx(absolute(name))),
    resolveCname: (name: string) =>
      lookup((resolver) => resolver.resolveCname(absolute(name))),
  };
}

/** A fresh, bounded TXT lookup; see `freshDnsLookups`. */
export function resolveTxtWithTimeout(
  name: string,
  timeoutMs = DNS_ATTEMPT_TIMEOUT_MS,
): Promise<string[][]> {
  return freshDnsLookups(timeoutMs).resolveTxt(name);
}
