import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, teamMembers, teams } from "../db/schema";
import { createApiKey } from "../apikey/queries";
import { deleteTeamMediaFiles } from "../media/queries";

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;

/** `defaultApiKeySecret` is the one-time plaintext of the team's default API
 * key — keys are stored hashed, so this is the only moment it exists. Present
 * only when the team was actually created (not on find-or-create hits). */
export type CreatedTeam = Team & { defaultApiKeySecret?: string };

export async function getTeam(id: string): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, id))
        .limit(1);
    return row ?? null;
}

/** Public-id lookup — used at the outermost edges (auth header, route
 * params, provisioning) that speak the public `teamId`, never the internal
 * `id`. See `apps/api/AGENTS.md`/`SCHEMA_ID_REFACTOR_PLAN.md` Task B. */
export async function getTeamByTeamId(teamId: string): Promise<Team | null> {
    const [row] = await db
        .select()
        .from(teams)
        .where(eq(teams.teamId, teamId))
        .limit(1);
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
 *
 * `withDefaultApiKey` opts into also minting a "Default" API key for the new
 * team — only worth doing when the caller has an actual way to hand the
 * one-time secret to whoever needs it (provisioning's response body,
 * bootstrap's startup log). Dashboard/MCP-driven team creation has no such
 * surface, so it defaults to `false`: better to have the user mint a key
 * explicitly (and see it) than to silently burn one they'll never see.
 */
export async function createTeam({
    ownerAccountId,
    name,
    externalId,
    withDefaultApiKey = false,
}: {
    ownerAccountId: string;
    name: string;
    externalId?: string;
    withDefaultApiKey?: boolean;
}): Promise<CreatedTeam> {
    const [team] = await db
        .insert(teams)
        .values({ ownerAccountId, name, externalId })
        .returning();

    await db
        .insert(teamMembers)
        .values({ teamId: team.id, accountId: ownerAccountId, role: "owner" });

    if (!withDefaultApiKey) return team;

    const { secret } = await createApiKey(team.id, "Default");
    return { ...team, defaultApiKeySecret: secret };
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
}): Promise<CreatedTeam> {
    const existing = await getTeamByExternalId(externalId);
    if (existing) return existing;
    // Provisioning's response body is the consumer's only way to receive the
    // key, so this path always mints one (unlike other `createTeam` callers).
    return createTeam({
        ownerAccountId,
        name,
        externalId,
        withDefaultApiKey: true,
    });
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
    await deleteTeamMediaFiles(teamId);
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
            and(
                eq(teamMembers.teamId, teamId),
                eq(teamMembers.accountId, accountId),
            ),
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
