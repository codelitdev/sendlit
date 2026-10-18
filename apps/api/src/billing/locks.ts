import { asc, eq } from "drizzle-orm";
import type { db } from "../db/client";
import { billingSubscriptions } from "../db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks an organization's subscription rows, ordered by ID. Call it first in
 * any transaction that will also lock the organization's plan state:
 * the engine's projection locks the subscription before the plan state, and
 * `commercialState({ transaction })` locks plan state before subscription, so
 * taking subscriptions first keeps one global lock order and avoids
 * deadlocks with webhook projection.
 */
export async function lockOrganizationSubscriptions(
  tx: Transaction,
  organizationId: string,
) {
  return tx
    .select({ id: billingSubscriptions.id })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.billableEntityId, organizationId))
    .orderBy(asc(billingSubscriptions.id))
    .for("update");
}
