import { eq } from "drizzle-orm";
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
 * templates/sequences immediately — mirrors MediaLit's "every new user gets a
 * default API key" behaviour, just one level deeper now that resources are
 * team-scoped rather than account-scoped.
 */
export async function createAccount(
  email: string,
  name?: string,
): Promise<Account> {
  const [account] = await db
    .insert(accounts)
    .values({ email, name })
    .returning();

  await createTeam({
    ownerAccountId: account.id,
    name: name ? `${name}'s Team` : "My Team",
  });

  return account;
}
