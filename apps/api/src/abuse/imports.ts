import { and, count, eq, gte, sql } from "drizzle-orm";
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
 * the existing list. A new account's flag is high severity, which holds its
 * campaigns until an operator releases it (`assertNoImportUnderReview`).
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
  const [{ imported }] = await db
    .select({
      imported: sql<number>`coalesce(sum((${organizationAuditEvents.metadata}->>'created')::int), 0)`,
    })
    .from(organizationAuditEvents)
    .where(
      and(
        eq(organizationAuditEvents.organizationId, team.organizationId),
        eq(organizationAuditEvents.action, "contacts.imported"),
        gte(organizationAuditEvents.createdAt, new Date(now - DAY_MS)),
      ),
    );
  const [{ total }] = await db
    .select({ total: count() })
    .from(contacts)
    .innerJoin(teams, eq(teams.id, contacts.teamId))
    .where(eq(teams.organizationId, team.organizationId));
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
  const importedLastDay = Number(imported);
  const existingBefore = Math.max(Number(total) - importedLastDay, 0);
  const threshold = isNew
    ? config.importAlertContactsNewAccount
    : config.importAlertContacts;
  const overThreshold = importedLastDay >= threshold;
  const bigJump =
    importedLastDay >= GROWTH_ALERT_FLOOR &&
    importedLastDay > config.importAlertGrowthFactor * Math.max(existingBefore, 1);
  if (!overThreshold && !bigJump) return;

  const hold = isNew && config.holdLargeImportsOfNewAccounts;
  await raiseAbuseFlag({
    organizationId: team.organizationId,
    teamId: input.teamId,
    userId: input.userId,
    kind: "import",
    severity: hold ? "high" : "medium",
    reason: overThreshold
      ? `Imported ${importedLastDay} contacts in 24 hours (threshold ${threshold})`
      : `Imported ${importedLastDay} contacts in 24 hours onto a list of ${existingBefore}`,
    details: {
      organization: organization.publicId,
      accountAgeDays: ageDays,
      plan: (await getOrganizationEntitlements(team.organizationId)).plan,
      importedLast24h: importedLastDay,
      existingContacts: existingBefore,
      latestBatch: classifyEmails(input.createdEmails),
      source: input.source ?? null,
      campaignsHeld: hold,
    },
  });
}

/** Throws `import_under_review` while a new account's large import waits for
 * an operator. */
export async function assertNoImportUnderReview(organizationId: string): Promise<void> {
  if (!abuseControlsEnabled()) return;
  const [held] = await db
    .select({ id: abuseFlags.id })
    .from(abuseFlags)
    .where(
      and(
        eq(abuseFlags.organizationId, organizationId),
        eq(abuseFlags.kind, "import"),
        eq(abuseFlags.status, "open"),
        eq(abuseFlags.severity, "high"),
      ),
    )
    .limit(1);
  if (held) throw new Error("import_under_review");
}
