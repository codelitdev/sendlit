import { and, count, eq, gte, isNull, or, sql } from "drizzle-orm";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { db } from "../db/client";
import {
  abuseFlags,
  contacts,
  organizationAuditEvents,
  organizations,
  teams,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "../organization/audit";
import { abuseControlsEnabled, readAbuseConfig } from "./config";
import { classifyEmails } from "./email-domains";
import { raiseAbuseFlag } from "./flags";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A list that grows by the configured factor alerts only from this size,
 * so small lists don't page anyone. */
const GROWTH_ALERT_FLOOR = 500;

/**
 * Records an import in the organization's audit log and, on hosted, alerts
 * operators when the organization imported more than the thresholds in the
 * last 24 hours: an absolute count (lower for new accounts) or a jump over
 * the existing list. A new account's flag is high severity, which holds the
 * importing team's campaigns until an operator releases it
 * (`assertNoImportUnderReview`).
 */
export async function recordContactImport(input: {
  teamId: string;
  userId?: string | null;
  createdEmails: string[];
  updated: number;
  skipped: number;
  suppressed: number;
  source?: string;
}): Promise<void> {
  const [team] = await db
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, input.teamId))
    .limit(1);
  if (!team) return;
  await recordOrganizationAuditEvent(db, {
    organizationId: team.organizationId,
    actor: input.userId ? { type: "user", id: input.userId } : { type: "system" },
    action: "contacts.imported",
    teamId: input.teamId,
    metadata: {
      created: input.createdEmails.length,
      updated: input.updated,
      skipped: input.skipped,
      suppressed: input.suppressed,
      ...(input.source && { source: input.source.slice(0, 200) }),
    },
  });
  if (!abuseControlsEnabled() || input.createdEmails.length === 0) return;

  const config = readAbuseConfig();
  const now = Date.now();
  const since = new Date(now - DAY_MS);
  const importRows = await db
    .select({
      teamId: organizationAuditEvents.teamId,
      imported: sql<number>`coalesce(sum((${organizationAuditEvents.metadata}->>'created')::int), 0)`,
    })
    .from(organizationAuditEvents)
    .where(
      and(
        eq(organizationAuditEvents.organizationId, team.organizationId),
        eq(organizationAuditEvents.action, "contacts.imported"),
        gte(organizationAuditEvents.createdAt, since),
      ),
    )
    .groupBy(organizationAuditEvents.teamId);
  const contactRows = await db
    .select({ teamId: contacts.teamId, total: count() })
    .from(contacts)
    .innerJoin(teams, eq(teams.id, contacts.teamId))
    .where(eq(teams.organizationId, team.organizationId))
    .groupBy(contacts.teamId);
  const [organization] = await db
    .select({
      createdAt: organizations.createdAt,
      publicId: organizations.organizationId,
    })
    .from(organizations)
    .where(eq(organizations.id, team.organizationId))
    .limit(1);
  const ageDays = Math.floor((now - organization.createdAt.getTime()) / DAY_MS);
  const isNew = ageDays < config.newAccountDays;
  const threshold = isNew
    ? config.importAlertContactsNewAccount
    : config.importAlertContacts;
  const judge = (imported: number, total: number) => {
    const existingBefore = Math.max(total - imported, 0);
    return {
      imported,
      existingBefore,
      overThreshold: imported >= threshold,
      bigJump:
        imported >= GROWTH_ALERT_FLOOR &&
        imported > config.importAlertGrowthFactor * Math.max(existingBefore, 1),
    };
  };
  // Each team is judged on its own imports, so a flag holds only the team
  // that imported. A list split across teams is still caught: what the
  // teams that aren't over on their own imported together is judged too,
  // and with no single team to blame that flag holds the whole organization.
  const byTeam = new Map<string | null, { imported: number; total: number }>();
  const entry = (id: string | null) => {
    const value = byTeam.get(id) ?? { imported: 0, total: 0 };
    byTeam.set(id, value);
    return value;
  };
  for (const row of importRows) entry(row.teamId).imported += Number(row.imported);
  for (const row of contactRows) entry(row.teamId).total += Number(row.total);
  const flagged = (result: ReturnType<typeof judge>) =>
    result.overThreshold || result.bigJump;
  const rest = { imported: 0, total: 0 };
  for (const [id, value] of byTeam) {
    if (id !== null && flagged(judge(value.imported, value.total))) continue;
    rest.imported += value.imported;
    rest.total += value.total;
  }
  const own = byTeam.get(input.teamId) ?? { imported: 0, total: 0 };
  const teamResult = judge(own.imported, own.total);
  const teamFlagged = flagged(teamResult);
  const result = teamFlagged ? teamResult : judge(rest.imported, rest.total);
  if (!result.overThreshold && !result.bigJump) return;

  const hold = isNew && config.holdLargeImportsOfNewAccounts;
  await raiseAbuseFlag({
    organizationId: team.organizationId,
    teamId: teamFlagged ? input.teamId : null,
    userId: input.userId,
    kind: "import",
    severity: hold ? "high" : "medium",
    reason: result.overThreshold
      ? `Imported ${result.imported} contacts in 24 hours (threshold ${threshold})`
      : `Imported ${result.imported} contacts in 24 hours onto a list of ${result.existingBefore}`,
    details: {
      organization: organization.publicId,
      scope: teamFlagged ? "team" : "organization",
      accountAgeDays: ageDays,
      plan: (await getOrganizationEntitlements(team.organizationId)).plan,
      importedLast24h: result.imported,
      existingContacts: result.existingBefore,
      latestBatch: classifyEmails(input.createdEmails),
      source: input.source ?? null,
      campaignsHeld: hold,
    },
  });
}

/** Throws `import_under_review` while a large import by this team on a new
 * account waits for an operator. Only the team that imported is held, so
 * other teams in the organization keep sending; a flag with no team (raised
 * before flags were per team) still holds the whole organization. */
export async function assertNoImportUnderReview(teamId: string): Promise<void> {
  if (!abuseControlsEnabled()) return;
  const [held] = await db
    .select({ id: abuseFlags.id })
    .from(abuseFlags)
    .innerJoin(teams, eq(teams.organizationId, abuseFlags.organizationId))
    .where(
      and(
        eq(teams.id, teamId),
        eq(abuseFlags.kind, "import"),
        eq(abuseFlags.status, "open"),
        eq(abuseFlags.severity, "high"),
        or(eq(abuseFlags.teamId, teamId), isNull(abuseFlags.teamId)),
      ),
    )
    .limit(1);
  if (held) throw new Error("import_under_review");
}
