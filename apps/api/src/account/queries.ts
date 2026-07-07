import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { accounts } from "../db/schema";
import { createTeam } from "../team/queries";

export type Account = typeof accounts.$inferSelect;

export async function getAccount(id: string): Promise<Account | null> {
    const [row] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1);
    return row ?? null;
}

export async function findAccountByEmail(
    email: string,
): Promise<Account | null> {
    const [row] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email, email))
        .limit(1);
    return row ?? null;
}

/**
 * Creates a login identity and, as a side effect, a default team owned by it
 * (named after the account) so the account has somewhere to put contacts/
 * templates/sequences immediately.
 *
 * `withDefaultApiKey` is forwarded to `createTeam` — leave it `false` (the
 * default) for normal signups, where there's no surface to show the user the
 * one-time secret; pass `true` only for callers that can actually hand it to
 * someone (e.g. `bootstrap.ts`, which logs it once at startup).
 */
export async function createAccount(
    email: string,
    name?: string,
    withDefaultApiKey = false,
): Promise<Account & { defaultTeamId: string; defaultApiKeySecret?: string }> {
    const [account] = await db
        .insert(accounts)
        .values({ email, name })
        .returning();

    const team = await createTeam({
        ownerAccountId: account.id,
        name: name ? `${name}'s Team` : "My Team",
        withDefaultApiKey,
    });

    return {
        ...account,
        defaultTeamId: team.id,
        defaultApiKeySecret: team.defaultApiKeySecret,
    };
}

const DAY_IN_MILLIS = 24 * 60 * 60 * 1000;
const MONTH_IN_MILLIS = 30 * DAY_IN_MILLIS;

/**
 * Returns whether the account still has daily/monthly sending quota left,
 * resetting the counters first if the relevant window has elapsed. Quota is
 * account-level (the billable identity) and shared across all teams the
 * account owns — callers sending on behalf of a team pass the team's
 * `ownerAccountId`.
 */
export async function hasMailQuotaRemaining(
    accountId: string,
): Promise<boolean> {
    const account = await getAccount(accountId);
    if (!account) return false;

    const resetAt = account.countersResetAt?.getTime() ?? 0;
    const now = Date.now();

    let dailyMailCount = account.dailyMailCount;
    let monthlyMailCount = account.monthlyMailCount;

    if (now - resetAt > MONTH_IN_MILLIS) {
        dailyMailCount = 0;
        monthlyMailCount = 0;
        await db
            .update(accounts)
            .set({
                dailyMailCount,
                monthlyMailCount,
                countersResetAt: new Date(),
            })
            .where(eq(accounts.id, accountId));
    } else if (now - resetAt > DAY_IN_MILLIS) {
        dailyMailCount = 0;
        await db
            .update(accounts)
            .set({ dailyMailCount, countersResetAt: new Date() })
            .where(eq(accounts.id, accountId));
    }

    return (
        dailyMailCount < account.dailyMailLimit &&
        monthlyMailCount < account.monthlyMailLimit
    );
}

export async function incrementMailCount(accountId: string): Promise<void> {
    await db
        .update(accounts)
        .set({
            dailyMailCount: sql`${accounts.dailyMailCount} + 1`,
            monthlyMailCount: sql`${accounts.monthlyMailCount} + 1`,
        })
        .where(eq(accounts.id, accountId));
}
