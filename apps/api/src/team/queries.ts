import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, teamMembers, teams } from "../db/schema";
import { createApiKey } from "../apikey/queries";

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;

export async function getTeam(id: string): Promise<Team | null> {
  const [row] = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return row ?? null;
}

export async function getTeamByExternalId(
  externalId: string,
): Promise<Team | null> {
  const [row] = await db
    .select()
    .from(teams)
    .where(eq(teams.externalId, externalId))
    .limit(1);
  return row ?? null;
}

/**
 * Creates a team owned by `ownerAccountId` and adds that account as its
 * `owner` member. Every account gets one of these automatically on creation
 * (see `account/queries.ts#createAccount`), and can create more freely.
 */
export async function createTeam({
  ownerAccountId,
  name,
  externalId,
}: {
  ownerAccountId: string;
  name: string;
  externalId?: string;
}): Promise<Team> {
  const [team] = await db
    .insert(teams)
    .values({ ownerAccountId, name, externalId })
    .returning();

  await db
    .insert(teamMembers)
    .values({ teamId: team.id, accountId: ownerAccountId, role: "owner" });

  // Every team gets a default API key so it's immediately usable via the
  // REST/MCP surface, mirroring MediaLit's "Apps" ergonomics.
  await createApiKey(team.id, "Default");

  return team;
}

/**
 * Idempotent find-or-create keyed by a consumer-supplied `externalId` (e.g.
 * `courselit:<domainId>`) — used by `provisioning/routes.ts` so a
 * multi-tenant consumer can safely call this on every request without
 * tracking "have I already provisioned this tenant" state itself. Note this
 * intentionally does *not* key off `ownerEmail`, since two of the consumer's
 * own tenants may share an owner email — that would incorrectly merge them
 * into one team.
 */
export async function findOrCreateTeamByExternalId({
  externalId,
  ownerAccountId,
  name,
}: {
  externalId: string;
  ownerAccountId: string;
  name: string;
}): Promise<Team> {
  const existing = await getTeamByExternalId(externalId);
  if (existing) return existing;
  return createTeam({ ownerAccountId, name, externalId });
}

export async function renameTeam(
  teamId: string,
  name: string,
): Promise<Team | null> {
  const [row] = await db
    .update(teams)
    .set({ name, updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  return row ?? null;
}

export async function deleteTeam(teamId: string): Promise<void> {
  await db.delete(teams).where(eq(teams.id, teamId));
}

export async function listTeamsForAccount(accountId: string): Promise<Team[]> {
  const rows = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.accountId, accountId));
  return rows.map((r) => r.team);
}

export async function getTeamMembership(
  teamId: string,
  accountId: string,
): Promise<TeamMember | null> {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.accountId, accountId)),
    )
    .limit(1);
  return row ?? null;
}

/** Find-or-create an account by email without the "give it a default team"
 * side effect of `account/queries.ts#createAccount` — used by provisioning,
 * where the caller supplies its own team (so we don't want a spare, unused
 * personal team created alongside it). */
export async function findOrCreateBareAccount(
  email: string,
  name?: string,
): Promise<typeof accounts.$inferSelect> {
  const normalized = email.toLowerCase();
  const [existing] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, normalized))
    .limit(1);
  if (existing) return existing;

  const [account] = await db
    .insert(accounts)
    .values({ email: normalized, name })
    .returning();
  return account;
}

const DAY_IN_MILLIS = 24 * 60 * 60 * 1000;
const MONTH_IN_MILLIS = 30 * DAY_IN_MILLIS;

/**
 * Returns whether the team still has daily/monthly sending quota left,
 * resetting the counters first if the relevant window has elapsed.
 */
export async function hasMailQuotaRemaining(teamId: string): Promise<boolean> {
  const team = await getTeam(teamId);
  if (!team) return false;

  const resetAt = team.countersResetAt?.getTime() ?? 0;
  const now = Date.now();

  let dailyMailCount = team.dailyMailCount;
  let monthlyMailCount = team.monthlyMailCount;

  if (now - resetAt > MONTH_IN_MILLIS) {
    dailyMailCount = 0;
    monthlyMailCount = 0;
    await db
      .update(teams)
      .set({ dailyMailCount, monthlyMailCount, countersResetAt: new Date() })
      .where(eq(teams.id, teamId));
  } else if (now - resetAt > DAY_IN_MILLIS) {
    dailyMailCount = 0;
    await db
      .update(teams)
      .set({ dailyMailCount, countersResetAt: new Date() })
      .where(eq(teams.id, teamId));
  }

  return (
    dailyMailCount < team.dailyMailLimit &&
    monthlyMailCount < team.monthlyMailLimit
  );
}

export async function incrementMailCount(teamId: string): Promise<void> {
  await db
    .update(teams)
    .set({
      dailyMailCount: sql`${teams.dailyMailCount} + 1`,
      monthlyMailCount: sql`${teams.monthlyMailCount} + 1`,
    })
    .where(eq(teams.id, teamId));
}
