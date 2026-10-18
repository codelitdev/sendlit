import { BillingWorkflowError } from "@codelitdev/billing/core";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { organizations, user } from "../db/schema";
import { readBillingConfig } from "./catalog";
import { BillingCheckoutError } from "./checkout";
import { getBillingEngine } from "./engine";

export async function createOrganizationPortal(input: {
  organizationId: string;
  userId: string;
  grant: BillingActionGrant;
}) {
  let config: ReturnType<typeof readBillingConfig>;
  try {
    config = readBillingConfig();
  } catch {
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  }
  if (config.deploymentMode !== "cloud")
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  const [organization] = await db
    .select({ publicId: organizations.organizationId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization)
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  const [payer] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!payer) throw new BillingCheckoutError("billing_owner_required", 403);
  const webClient = process.env.WEB_CLIENT;
  if (!webClient) throw new BillingCheckoutError("billing_provider_unavailable", 503);
  const billing = getBillingEngine();
  // Check before startPortal so the single-use grant is not spent when there
  // is no paid subscription to manage.
  const commercial = await billing.commercialState(input.organizationId);
  if (!commercial.activePaidPlan) {
    throw new BillingCheckoutError("payment_required", 402);
  }
  try {
    const session = await billing.startPortal({
      grant: input.grant,
      entity: { kind: "organization", id: input.organizationId },
      payer: {
        id: payer.id,
        email: payer.email,
        name: payer.name || payer.email,
      },
      returnUrl: `${new URL(webClient).origin}/organizations?tab=plan&organization=${encodeURIComponent(organization.publicId)}`,
    });
    return { portalUrl: session.portalUrl };
  } catch (error) {
    if (error instanceof BillingCheckoutError) throw error;
    const code = error instanceof BillingWorkflowError ? error.code : "";
    if (code === "payer_mismatch" || code === "grant_invalid") {
      throw new BillingCheckoutError("billing_owner_required", 403);
    }
    if (code === "subscription_required") {
      throw new BillingCheckoutError("payment_required", 402);
    }
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  }
}
