import type { Reputation } from "@sendlit/api-contract";
import { and, asc, eq, gte, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  espConfigs,
  espConfigTeamGrants,
  reputationConnections,
  reputationDailyStats,
} from "../db/schema";
import { sendingDomainOf } from "../settings/esp/domain-auth";
import { encryptSecret } from "../utils/secret-crypto";
import { googlePostmasterConfig } from "./google";

export type ReputationProvider = "google_postmaster" | "microsoft_snds";
export type ReputationConnection = typeof reputationConnections.$inferSelect;
type Alert = Reputation["alerts"][number];

/** Gmail's thresholds: keep user-reported spam under 0.1%, never reach 0.3%. */
export const SPAM_RATE_WARNING = 0.001;
export const SPAM_RATE_LIMIT = 0.003;

const HISTORY_DAYS = 30;

export async function getConnection(teamId: string, provider: ReputationProvider) {
  const [row] = await db
    .select()
    .from(reputationConnections)
    .where(
      and(
        eq(reputationConnections.teamId, teamId),
        eq(reputationConnections.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Creates or replaces a team's connection; a new secret starts clean and
 * syncs right away. */
export async function saveConnection(
  teamId: string,
  provider: ReputationProvider,
  secret: string,
  accountLabel: string | null,
) {
  const values = {
    encryptedSecret: encryptSecret(secret),
    accountLabel,
    status: "active",
    lastError: null,
    nextSyncAt: new Date(),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(reputationConnections)
    .values({ teamId, provider, ...values })
    .onConflictDoUpdate({
      target: [reputationConnections.teamId, reputationConnections.provider],
      set: values,
    })
    .returning();
  return row;
}

export async function deleteConnection(teamId: string, provider: ReputationProvider) {
  const rows = await db
    .delete(reputationConnections)
    .where(
      and(
        eq(reputationConnections.teamId, teamId),
        eq(reputationConnections.provider, provider),
      ),
    )
    .returning({ id: reputationConnections.id });
  return rows.length > 0;
}

/** Upserts daily numbers for one subject (domain or IP). */
export async function saveDailyStats(
  connectionId: string,
  subject: string,
  days: Record<string, Record<string, unknown>>,
) {
  for (const [day, metrics] of Object.entries(days)) {
    await db
      .insert(reputationDailyStats)
      .values({ connectionId, subject, day, metrics })
      .onConflictDoUpdate({
        target: [
          reputationDailyStats.connectionId,
          reputationDailyStats.subject,
          reputationDailyStats.day,
        ],
        set: { metrics, updatedAt: new Date() },
      });
  }
}

/** Domains the team sends from: its own ESPs and mailboxes granted to it. */
export async function teamSendingDomains(teamId: string): Promise<string[]> {
  const grantedEspIds = db
    .select({ id: espConfigTeamGrants.espConfigId })
    .from(espConfigTeamGrants)
    .where(
      and(
        eq(espConfigTeamGrants.teamId, teamId),
        eq(espConfigTeamGrants.status, "active"),
      ),
    );
  const rows = await db
    .select({ fromEmail: espConfigs.fromEmail })
    .from(espConfigs)
    .where(
      and(
        isNotNull(espConfigs.fromEmail),
        ne(espConfigs.status, "retired"),
        or(eq(espConfigs.teamId, teamId), inArray(espConfigs.id, grantedEspIds)),
      ),
    );
  return [
    ...new Set(
      rows.map((row) => sendingDomainOf(row.fromEmail)).filter(Boolean) as string[],
    ),
  ].sort();
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function toConnection(row: ReputationConnection | null) {
  return row
    ? {
        status: row.status as "active" | "error",
        accountLabel: row.accountLabel,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastError: row.lastError,
        connectedAt: row.createdAt.toISOString(),
      }
    : null;
}

type GoogleSubjectState = {
  status?: "ok" | "not_in_postmaster";
  compliance?: { status: "compliant" | "needs_work" | "unknown"; needsWork: string[] };
};

const percent = (value: number) => `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** What's wrong right now, from each subject's latest day. */
export function alertsFor(
  google: Reputation["google"]["domains"],
  snds: Reputation["snds"]["ips"],
): Alert[] {
  const alerts: Alert[] = [];
  for (const domain of google) {
    const spamRate = [...domain.days]
      .reverse()
      .find((day) => day.spamRate !== null)?.spamRate;
    if (spamRate != null && spamRate >= SPAM_RATE_WARNING) {
      const critical = spamRate >= SPAM_RATE_LIMIT;
      alerts.push({
        provider: "google_postmaster",
        subject: domain.domain,
        signal: "spam_rate",
        level: critical ? "critical" : "warning",
        message: critical
          ? `Gmail users marked ${percent(spamRate)} of mail from ${domain.domain} as spam, above Google's 0.3% limit for bulk senders. Gmail may reject or junk your mail.`
          : `Gmail users marked ${percent(spamRate)} of mail from ${domain.domain} as spam. Keep it under 0.1%.`,
      });
    }
    if (domain.compliance?.status === "needs_work") {
      alerts.push({
        provider: "google_postmaster",
        subject: domain.domain,
        signal: "compliance",
        level: "warning",
        message: `Google says ${domain.domain} doesn't meet its sender requirements: ${domain.compliance.needsWork
          .map((item) => item.toLowerCase().replace(/_/g, " "))
          .join(", ")}.`,
      });
    }
  }
  for (const ip of snds) {
    const filter = [...ip.days].reverse().find((day) => day.filterResult)?.filterResult;
    if (filter === "red" || filter === "yellow") {
      alerts.push({
        provider: "microsoft_snds",
        subject: ip.ip,
        signal: "snds_filter",
        level: filter === "red" ? "critical" : "warning",
        message:
          filter === "red"
            ? `Outlook's filter rates most mail from ${ip.ip} as spam (SNDS red).`
            : `Outlook's filter rates some mail from ${ip.ip} as spam (SNDS yellow).`,
      });
    }
  }
  return alerts;
}

export async function getReputation(teamId: string): Promise<Reputation> {
  const [google, snds, domains] = await Promise.all([
    getConnection(teamId, "google_postmaster"),
    getConnection(teamId, "microsoft_snds"),
    teamSendingDomains(teamId),
  ]);
  const since = isoDay(new Date(Date.now() - HISTORY_DAYS * 86_400_000));
  const connectionIds = [google?.id, snds?.id].filter(Boolean) as string[];
  const stats = connectionIds.length
    ? await db
        .select()
        .from(reputationDailyStats)
        .where(
          and(
            inArray(reputationDailyStats.connectionId, connectionIds),
            gte(reputationDailyStats.day, since),
          ),
        )
        .orderBy(asc(reputationDailyStats.day))
    : [];
  const daysOf = (connectionId: string | undefined, subject: string) =>
    stats.filter((row) => row.connectionId === connectionId && row.subject === subject);

  const subjectState = (google?.subjectState ?? {}) as Record<
    string,
    GoogleSubjectState
  >;
  const googleDomains: Reputation["google"]["domains"] = google
    ? domains.map((domain) => {
        const state = subjectState[domain];
        return {
          domain,
          status: state?.status ?? "pending",
          compliance: state?.compliance ?? null,
          days: daysOf(google.id, domain).map((row) => {
            const m = row.metrics as Record<string, number | undefined>;
            return {
              day: row.day,
              spamRate: m.spamRate ?? null,
              spfRate: m.spfRate ?? null,
              dkimRate: m.dkimRate ?? null,
              dmarcRate: m.dmarcRate ?? null,
              deliveryErrorRate: m.deliveryErrorRate ?? null,
            };
          }),
        };
      })
    : [];

  const ips = snds
    ? [
        ...new Set(
          stats.filter((row) => row.connectionId === snds.id).map((row) => row.subject),
        ),
      ].sort()
    : [];
  const sndsIps: Reputation["snds"]["ips"] = ips.map((ip) => ({
    ip,
    days: daysOf(snds?.id, ip).map((row) => {
      const m = row.metrics as Record<string, any>;
      return {
        day: row.day,
        filterResult: m.filterResult ?? null,
        complaintRate: m.complaintRate ?? null,
        complaintRateText: m.complaintRateText ?? null,
        trapHits: m.trapHits ?? null,
        recipients: m.recipients ?? null,
      };
    }),
  }));

  return {
    google: {
      available: googlePostmasterConfig() !== null,
      connection: toConnection(google),
      domains: googleDomains,
    },
    snds: { connection: toConnection(snds), ips: sndsIps },
    alerts: alertsFor(googleDomains, sndsIps),
  };
}
