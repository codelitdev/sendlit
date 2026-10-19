import { and, eq, inArray } from "drizzle-orm";
import type { db } from "../db/client";
import { trialClaims } from "../db/schema";

type ClaimsDb = Pick<typeof db, "update">;

/** Releases trial claims that are still reserved for checkout attempts the
 * payer abandoned (switched offer, or abandoned the pending organization).
 * Without this, a payer who switches from `pro_month` to another offer and
 * back would lose the trial to a checkout that can no longer be completed.
 * Redeemed claims are never touched. */
export async function releaseTrialClaimsForAbandonedCheckouts(
  client: ClaimsDb,
  checkoutAttemptIds: readonly string[],
  now = new Date(),
): Promise<void> {
  if (checkoutAttemptIds.length === 0) return;
  await client
    .update(trialClaims)
    .set({ status: "released", updatedAt: now })
    .where(
      and(
        inArray(trialClaims.checkoutAttemptId, [...checkoutAttemptIds]),
        eq(trialClaims.status, "reserved"),
      ),
    );
}
