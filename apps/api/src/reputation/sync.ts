import { and, eq, lte } from "drizzle-orm";
import { notifyOrganizationOwners } from "../billing/notifications";
import { db } from "../db/client";
import { reputationConnections, teams } from "../db/schema";
import { captureError } from "../observability";
import logger from "../services/log";
import { decryptSecret } from "../utils/secret-crypto";
import {
  GoogleDomainNotFoundError,
  GoogleReauthorizeError,
  getGoogleCompliance,
  googleAccessToken,
  googlePostmasterConfig,
  queryGoogleDomainStats,
} from "./google";
import {
  getConnection,
  getReputation,
  type ReputationConnection,
  saveConnection,
  saveDailyStats,
  teamSendingDomains,
} from "./queries";
import { fetchSndsData, SndsLinkError, validateSndsUrl } from "./snds";

const DAY_MS = 86_400_000;
/** A failed sync is retried this much later. */
const RETRY_MS = 60 * 60 * 1000;

async function syncGoogle(connection: ReputationConnection) {
  const config = googlePostmasterConfig();
  if (!config) throw new Error("Google Postmaster Tools isn't set up on this SendLit");
  const accessToken = await googleAccessToken(
    config,
    decryptSecret(connection.encryptedSecret),
  );
  const subjectState: Record<string, unknown> = {};
  for (const domain of await teamSendingDomains(connection.teamId)) {
    try {
      const days = await queryGoogleDomainStats(config, accessToken, domain);
      await saveDailyStats(connection.id, domain, days);
      const compliance = await getGoogleCompliance(config, accessToken, domain).catch(
        (error) => {
          if (error instanceof GoogleDomainNotFoundError) return null;
          throw error;
        },
      );
      subjectState[domain] = { status: "ok", compliance };
    } catch (error) {
      if (!(error instanceof GoogleDomainNotFoundError)) throw error;
      subjectState[domain] = { status: "not_in_postmaster" };
    }
  }
  return { subjectState };
}

async function syncSnds(connection: ReputationConnection) {
  const data = await fetchSndsData(decryptSecret(connection.encryptedSecret));
  for (const [ip, days] of Object.entries(data)) {
    await saveDailyStats(connection.id, ip, days);
  }
  return {};
}

function failureMessage(connection: ReputationConnection, error: unknown): string {
  if (error instanceof GoogleReauthorizeError) {
    return "Google access expired or was revoked. Connect Postmaster Tools again.";
  }
  if (error instanceof SndsLinkError) {
    return "The SNDS link expired or doesn't return data. SNDS links last 30 days: paste a new one from SNDS's Automated Data Access page.";
  }
  return connection.provider === "google_postmaster"
    ? "Couldn't reach Google Postmaster Tools. SendLit will try again."
    : "Couldn't reach SNDS. SendLit will try again.";
}

const LEVELS = { warning: 1, critical: 2 } as const;

/** Emails the organization's owners about alerts that are new or worse
 * since the last sync, and remembers what was reported. */
async function notifyNewAlerts(connection: ReputationConnection) {
  const { alerts } = await getReputation(connection.teamId);
  const mine = alerts.filter((alert) => alert.provider === connection.provider);
  const previous = (connection.alertState ?? {}) as Record<string, keyof typeof LEVELS>;
  const current = Object.fromEntries(
    mine.map((alert) => [`${alert.subject}|${alert.signal}`, alert.level]),
  );
  const worse = mine.filter((alert) => {
    const before = previous[`${alert.subject}|${alert.signal}`];
    return !before || LEVELS[alert.level] > LEVELS[before];
  });
  await db
    .update(reputationConnections)
    .set({ alertState: current })
    .where(eq(reputationConnections.id, connection.id));
  if (worse.length === 0) return;
  const [team] = await db
    .select({ organizationId: teams.organizationId, name: teams.name })
    .from(teams)
    .where(eq(teams.id, connection.teamId))
    .limit(1);
  if (!team) return;
  const critical = worse.some((alert) => alert.level === "critical");
  await notifyOrganizationOwners(
    team.organizationId,
    `${critical ? "Action needed" : "Heads up"}: sender reputation for ${team.name}`,
    `${worse.map((alert) => `- ${alert.message}`).join("\n")}\n\nOpen SendLit to see the trend. Pausing sends to unengaged contacts and fixing authentication usually helps; see the warm-up and domain authentication guides.`,
  ).catch((error) => captureError({ error, source: "reputation.alert_email" }));
}

/** Pulls fresh data for one connection and records how it went. */
export async function syncConnection(connection: ReputationConnection): Promise<void> {
  try {
    const result =
      connection.provider === "google_postmaster"
        ? await syncGoogle(connection)
        : await syncSnds(connection);
    const [updated] = await db
      .update(reputationConnections)
      .set({
        status: "active",
        lastError: null,
        lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + DAY_MS),
        ...("subjectState" in result && { subjectState: result.subjectState }),
        updatedAt: new Date(),
      })
      .where(eq(reputationConnections.id, connection.id))
      .returning();
    if (updated) await notifyNewAlerts(updated);
  } catch (error) {
    const permanent =
      error instanceof GoogleReauthorizeError || error instanceof SndsLinkError;
    if (!permanent)
      captureError({ error, source: "reputation.sync", severity: "warning" });
    logger.warn(
      { provider: connection.provider, error: (error as Error).message },
      "reputation sync failed",
    );
    await db
      .update(reputationConnections)
      .set({
        status: "error",
        lastError: failureMessage(connection, error),
        // Broken credentials wait for the user; outages retry soon.
        nextSyncAt: new Date(Date.now() + (permanent ? DAY_MS : RETRY_MS)),
        updatedAt: new Date(),
      })
      .where(eq(reputationConnections.id, connection.id));
  }
}

/** Syncs every connection that's due, each claimed by one process. */
export async function syncDueConnections(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: reputationConnections.id })
    .from(reputationConnections)
    .where(lte(reputationConnections.nextSyncAt, now))
    .limit(50);
  let synced = 0;
  for (const { id } of due) {
    const [claimed] = await db
      .update(reputationConnections)
      .set({ nextSyncAt: new Date(now.getTime() + RETRY_MS) })
      .where(
        and(
          eq(reputationConnections.id, id),
          lte(reputationConnections.nextSyncAt, now),
        ),
      )
      .returning();
    if (!claimed) continue;
    await syncConnection(claimed);
    synced++;
  }
  return synced;
}

export async function syncTeamNow(teamId: string) {
  for (const provider of ["google_postmaster", "microsoft_snds"] as const) {
    const connection = await getConnection(teamId, provider);
    if (connection) await syncConnection(connection);
  }
}

export async function connectSnds(teamId: string, dataUrl: string) {
  const url = validateSndsUrl(dataUrl);
  await fetchSndsData(url);
  const connection = await saveConnection(teamId, "microsoft_snds", url, null);
  await syncConnection(connection);
}

let timer: NodeJS.Timeout | null = null;
let firstRun: NodeJS.Timeout | null = null;

export function startReputationSync() {
  if (timer) return;
  const run = () =>
    void syncDueConnections().catch((error) =>
      captureError({ error, source: "reputation.sync_loop" }),
    );
  const seconds = Number(process.env.REPUTATION_SYNC_CHECK_SECONDS) || 600;
  timer = setInterval(run, seconds * 1000);
  timer.unref();
  firstRun = setTimeout(run, 15_000);
  firstRun.unref();
}

export function stopReputationSync() {
  if (timer) clearInterval(timer);
  if (firstRun) clearTimeout(firstRun);
  timer = null;
  firstRun = null;
}
