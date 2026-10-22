import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { settings } from "../../db/schema";
import { captureEvent } from "../../observability";
import logger from "../../services/log";
import { freshDnsLookups } from "../../utils/dns";
import { getSiteUrl } from "../../utils/mail";
import { getTeamSettingsRow } from "../general/queries";

type TeamSettings = typeof settings.$inferSelect;

export type TrackingDomainStatus = "pending" | "verified" | "failed";

/** Why a check didn't pass, as a stable code. */
export type TrackingDomainError =
  | "cname_missing"
  | "cname_mismatch"
  | "unreachable"
  | "dns_error";

export interface TrackingDomain {
  domain: string | null;
  status: TrackingDomainStatus | null;
  /** The host the domain's CNAME must point to. */
  cnameTarget: string;
  error: TrackingDomainError | null;
  verifiedAt: Date | null;
  checkedAt: Date | null;
}

/** Path the verification probe requests on the custom domain; the API
 * answers it on any host. */
export const TRACKING_PROBE_PATH = "/.well-known/sendlit-tracking";
export const TRACKING_PROBE_BODY = { service: "sendlit-tracking" } as const;

/** Paths a custom tracking domain serves; everything else is 404 there. */
const TRACKING_PATHS = ["/track/", "/unsubscribe/", "/view/", TRACKING_PROBE_PATH];

/** A verified domain that fails this many daily rechecks in a row is marked
 * `failed`, and new emails go back to the API's own host. */
const FAILURES_BEFORE_FALLBACK = 3;
const PENDING_RECHECK_MS = 60 * 60 * 1000;
const VERIFIED_RECHECK_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function apiHostname(): string {
  return new URL(getSiteUrl()).hostname.toLowerCase();
}

/** Where tracking domains point their CNAME: `TRACKING_DOMAIN_CNAME_TARGET`,
 * or the API's own host. */
export function trackingCnameTarget(): string {
  return (process.env.TRACKING_DOMAIN_CNAME_TARGET || apiHostname())
    .toLowerCase()
    .replace(/\.$/, "");
}

function protocol(): string {
  return process.env.PROTOCOL || "https";
}

/** Lowercased host name of `input`, or throws `tracking_domain_invalid`. A
 * subdomain is required (an apex can't have a CNAME), and SendLit's own
 * hosts can't be claimed. */
export function normalizeTrackingDomain(input: string): string {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!HOSTNAME.test(domain) || domain.split(".").length < 3) {
    throw new Error("tracking_domain_invalid");
  }
  for (const own of new Set([apiHostname(), trackingCnameTarget()])) {
    if (domain === own || domain.endsWith(`.${own}`)) {
      throw new Error("tracking_domain_invalid");
    }
  }
  return domain;
}

function toTrackingDomain(row: TeamSettings | null): TrackingDomain {
  return {
    domain: row?.trackingDomain ?? null,
    status: (row?.trackingDomainStatus as TrackingDomainStatus | null) ?? null,
    cnameTarget: trackingCnameTarget(),
    error: (row?.trackingDomainError as TrackingDomainError | null) ?? null,
    verifiedAt: row?.trackingDomainVerifiedAt ?? null,
    checkedAt: row?.trackingDomainCheckedAt ?? null,
  };
}

/** The REST/MCP shape: dates as ISO strings. */
export function toPublicTrackingDomain(domain: TrackingDomain) {
  return {
    ...domain,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    checkedAt: domain.checkedAt?.toISOString() ?? null,
  };
}

/** Origin (`https://track.example.com`) for a team's links, or undefined to
 * use the API's own host. Only a verified domain is used. */
export function trackingOrigin(
  row: Pick<TeamSettings, "trackingDomain" | "trackingDomainStatus"> | null,
): string | undefined {
  return row?.trackingDomain && row.trackingDomainStatus === "verified"
    ? `${protocol()}://${row.trackingDomain}`
    : undefined;
}

export async function trackingOriginForTeam(
  teamId: string,
): Promise<string | undefined> {
  return trackingOrigin(await getTeamSettingsRow(teamId));
}

export async function getTrackingDomain(teamId: string): Promise<TrackingDomain> {
  return toTrackingDomain(await getTeamSettingsRow(teamId));
}

/**
 * Sets (or with `null`, removes) the team's tracking domain. A new domain
 * starts `pending` until `verifyTrackingDomain` passes. A domain that was
 * verified is kept as retired, so links already sent on it keep working.
 * Throws `tracking_domain_invalid` or `tracking_domain_taken`.
 */
export async function setTrackingDomain(
  teamId: string,
  input: string | null,
): Promise<TrackingDomain> {
  const domain =
    input === null || input.trim() === "" ? null : normalizeTrackingDomain(input);
  const existing = await getTeamSettingsRow(teamId);
  if ((existing?.trackingDomain ?? null) === domain) return toTrackingDomain(existing);

  const retired = new Set(existing?.retiredTrackingDomains ?? []);
  if (existing?.trackingDomain && existing.trackingDomainVerifiedAt) {
    retired.add(existing.trackingDomain);
  }
  if (domain) retired.delete(domain);
  const values = {
    trackingDomain: domain,
    trackingDomainStatus: domain ? "pending" : null,
    trackingDomainError: null,
    trackingDomainVerifiedAt: null,
    trackingDomainCheckedAt: null,
    trackingDomainFailures: 0,
    retiredTrackingDomains: [...retired],
    updatedAt: new Date(),
  };
  try {
    const [row] = existing
      ? await db
          .update(settings)
          .set(values)
          .where(eq(settings.teamId, teamId))
          .returning()
      : await db
          .insert(settings)
          .values({ teamId, ...values })
          .returning();
    forgetTrackingHosts();
    captureEvent({
      event: domain ? "tracking_domain_set" : "tracking_domain_removed",
      source: "settings.tracking_domain",
      teamId,
    });
    return toTrackingDomain(row);
  } catch (error: any) {
    const code = error?.code ?? error?.cause?.code;
    if (code === "23505") throw new Error("tracking_domain_taken");
    throw error;
  }
}

/** Checks the CNAME and that the API answers over HTTPS(-or `PROTOCOL`) on
 * the domain. Returns null when both work. */
type CheckDeps = {
  resolveCname?: (name: string) => Promise<string[]>;
  fetch?: typeof fetch;
};

export async function checkTrackingDomain(
  domain: string,
  deps: CheckDeps = {},
): Promise<TrackingDomainError | null> {
  const resolveCname = deps.resolveCname ?? freshDnsLookups().resolveCname;
  try {
    const targets = (await resolveCname(domain)).map((target) =>
      target.toLowerCase().replace(/\.$/, ""),
    );
    if (!targets.includes(trackingCnameTarget())) return "cname_mismatch";
  } catch (error: any) {
    return ["ENOTFOUND", "ENODATA", "NOTFOUND", "NODATA"].includes(error?.code)
      ? "cname_missing"
      : "dns_error";
  }
  try {
    const response = await (deps.fetch ?? fetch)(
      `${protocol()}://${domain}${TRACKING_PROBE_PATH}`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "error" },
    );
    const body = (await response.json().catch(() => null)) as {
      service?: string;
    } | null;
    return response.ok && body?.service === TRACKING_PROBE_BODY.service
      ? null
      : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function recordCheck(
  row: TeamSettings,
  error: TrackingDomainError | null,
  now = new Date(),
): Promise<TeamSettings> {
  const failures = error ? row.trackingDomainFailures + 1 : 0;
  let status = row.trackingDomainStatus as TrackingDomainStatus;
  if (!error) status = "verified";
  else if (status === "verified" && failures >= FAILURES_BEFORE_FALLBACK)
    status = "failed";
  const [updated] = await db
    .update(settings)
    .set({
      trackingDomainStatus: status,
      trackingDomainError: error,
      trackingDomainCheckedAt: now,
      trackingDomainFailures: failures,
      ...(!error &&
        row.trackingDomainStatus !== "verified" && { trackingDomainVerifiedAt: now }),
    })
    .where(
      and(
        eq(settings.id, row.id),
        eq(settings.trackingDomain, row.trackingDomain ?? ""),
      ),
    )
    .returning();
  if (status !== row.trackingDomainStatus) {
    captureEvent({
      event: `tracking_domain_${status}`,
      source: "settings.tracking_domain",
      teamId: row.teamId,
      properties: error ? { error_code: error } : {},
    });
  }
  return updated ?? row;
}

/** Re-runs the check now (the dashboard's Verify button). */
export async function verifyTrackingDomain(teamId: string): Promise<TrackingDomain> {
  const row = await getTeamSettingsRow(teamId);
  if (!row?.trackingDomain) throw new Error("tracking_domain_not_set");
  return toTrackingDomain(
    await recordCheck(row, await checkTrackingDomain(row.trackingDomain)),
  );
}

/**
 * Rechecks due domains: pending ones hourly (so they verify on their own once
 * DNS has propagated), verified and failed ones daily. A verified domain that
 * keeps failing falls back to the API's host for new emails. Each row is
 * claimed by moving its check time first, so several API instances don't
 * check the same domain.
 */
export async function recheckTrackingDomains(
  now = new Date(),
  deps: CheckDeps = {},
): Promise<number> {
  const due = await db
    .select()
    .from(settings)
    .where(
      and(
        isNotNull(settings.trackingDomain),
        or(
          sql`${settings.trackingDomainCheckedAt} is null`,
          and(
            eq(settings.trackingDomainStatus, "pending"),
            lt(
              settings.trackingDomainCheckedAt,
              new Date(now.getTime() - PENDING_RECHECK_MS),
            ),
          ),
          and(
            inArray(settings.trackingDomainStatus, ["verified", "failed"]),
            lt(
              settings.trackingDomainCheckedAt,
              new Date(now.getTime() - VERIFIED_RECHECK_MS),
            ),
          ),
        ),
      ),
    )
    .limit(100);
  let checked = 0;
  for (const row of due) {
    const [claimed] = await db
      .update(settings)
      .set({ trackingDomainCheckedAt: now })
      .where(
        and(
          eq(settings.id, row.id),
          row.trackingDomainCheckedAt
            ? eq(settings.trackingDomainCheckedAt, row.trackingDomainCheckedAt)
            : sql`${settings.trackingDomainCheckedAt} is null`,
        ),
      )
      .returning();
    if (!claimed?.trackingDomain) continue;
    await recordCheck(
      claimed,
      await checkTrackingDomain(claimed.trackingDomain, deps),
      now,
    );
    checked++;
  }
  return checked;
}

export function startTrackingDomainChecks(intervalMs = 10 * 60 * 1000): () => void {
  const run = () =>
    recheckTrackingDomains().catch((error) =>
      logger.error({ error: error?.message }, "tracking domain recheck failed"),
    );
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// Host lookups for every request on a non-API host, cached briefly.
const hostCache = new Map<string, { tracking: boolean; expires: number }>();
const HOST_CACHE_MS = 60_000;

function forgetTrackingHosts() {
  hostCache.clear();
}

/** Whether `host` is (or was) a team's tracking domain. */
export async function isTrackingHost(host: string): Promise<boolean> {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === apiHostname()) return false;
  const cached = hostCache.get(name);
  if (cached && cached.expires > Date.now()) return cached.tracking;
  const [row] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(
      or(
        eq(settings.trackingDomain, name),
        sql`${name} = any(${settings.retiredTrackingDomains})`,
      ),
    )
    .limit(1);
  if (hostCache.size > 10_000) hostCache.clear();
  hostCache.set(name, { tracking: Boolean(row), expires: Date.now() + HOST_CACHE_MS });
  return Boolean(row);
}

/** Whether a request on a tracking domain may reach `path`. */
export function isTrackingPath(path: string): boolean {
  return TRACKING_PATHS.some((prefix) => path.startsWith(prefix));
}
