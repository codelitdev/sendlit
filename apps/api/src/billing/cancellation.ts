import { BillingWorkflowError } from "@codelitdev/billing/core";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";
import { billingErrorResponse } from "@codelitdev/platform/billing";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { user } from "../db/schema";
import { readBillingConfig } from "./catalog";
import { BillingCheckoutError } from "./checkout";
import { getBillingEngine } from "./engine";

/** An error from the cancel/resume workflows that SendLit has no code for.
 * It carries Platform's response shape (`billingErrorResponse`). */
export class BillingCancellationError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error: string; retryable?: boolean },
  ) {
    super(body.error);
    this.name = "BillingCancellationError";
  }
}

function mapCancellationError(error: unknown): Error {
  if (error instanceof BillingCheckoutError) return error;
  if (!(error instanceof BillingWorkflowError)) {
    return new BillingCheckoutError("billing_provider_unavailable", 503);
  }
  switch (error.code) {
    case "payer_mismatch":
    case "grant_invalid":
    case "grant_consumed":
      return new BillingCheckoutError("billing_owner_required", 403);
    case "subscription_required":
      return new BillingCheckoutError("billing_subscription_required", 402);
    case "operation_conflicted":
      // Resume while a cancellation job is mid-flight; retry shortly.
      return new BillingCheckoutError("operation_conflicted", 409, {
        retryable: true,
      });
    case "provider_unavailable":
      return new BillingCheckoutError("billing_provider_unavailable", 503);
    default: {
      const response = billingErrorResponse(error);
      return new BillingCancellationError(response.status, response.body);
    }
  }
}

async function payerFor(userId: string) {
  const [payer] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!payer) throw new BillingCheckoutError("billing_owner_required", 403);
  return { id: payer.id, email: payer.email, name: payer.name || payer.email };
}

function assertCloud() {
  let cloud = false;
  try {
    cloud = readBillingConfig().deploymentMode === "cloud";
  } catch {
    cloud = false;
  }
  if (!cloud) throw new BillingCheckoutError("billing_provider_unavailable", 503);
}

type Input = { organizationId: string; userId: string; grant: BillingActionGrant };

/** Schedules cancellation at the end of the paid period. Paid access stays
 * until `paidThroughAt`; the engine's deadline batch releases it then. */
export async function cancelOrganizationSubscription(input: Input) {
  assertCloud();
  const payer = await payerFor(input.userId);
  try {
    return await getBillingEngine().cancel({
      grant: input.grant,
      entity: { kind: "organization", id: input.organizationId },
      payer,
    });
  } catch (error) {
    throw mapCancellationError(error);
  }
}

/** Clears a cancellation scheduled for the period end. */
export async function resumeOrganizationSubscription(input: Input) {
  assertCloud();
  const payer = await payerFor(input.userId);
  try {
    return await getBillingEngine().resumeCancellation({
      grant: input.grant,
      entity: { kind: "organization", id: input.organizationId },
      payer,
    });
  } catch (error) {
    throw mapCancellationError(error);
  }
}
