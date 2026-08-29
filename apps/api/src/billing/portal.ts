import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingProviderCustomers,
    organizationPlanStates,
    organizationSubscriptions,
    organizations,
} from "../db/schema";
import { readBillingConfig } from "./catalog";
import { getBillingProvider } from "./provider-registry";
import { BillingCheckoutError } from "./checkout";

export async function createOrganizationPortal(input: {
    organizationId: string;
    userId: string;
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
    const [state] = await db
        .select()
        .from(organizationPlanStates)
        .where(eq(organizationPlanStates.organizationId, input.organizationId))
        .limit(1);
    if (!state?.activeSubscriptionId)
        throw new BillingCheckoutError("payment_required", 402);
    const [subscription] = await db
        .select({
            customerId: organizationSubscriptions.billingCustomerId,
            manager: organizationSubscriptions.billingManagerUserId,
            provider: organizationSubscriptions.provider,
        })
        .from(organizationSubscriptions)
        .where(
            and(
                eq(organizationSubscriptions.id, state.activeSubscriptionId),
                eq(
                    organizationSubscriptions.organizationId,
                    input.organizationId,
                ),
            ),
        )
        .limit(1);
    if (!subscription || subscription.manager !== input.userId)
        throw new BillingCheckoutError("billing_owner_required", 403);
    const [customer] = await db
        .select({
            providerCustomerId: billingProviderCustomers.providerCustomerId,
        })
        .from(billingProviderCustomers)
        .where(eq(billingProviderCustomers.id, subscription.customerId))
        .limit(1);
    if (!customer?.providerCustomerId)
        throw new BillingCheckoutError("billing_provider_unavailable", 503);
    try {
        const provider = getBillingProvider(subscription.provider);
        const webClient = process.env.WEB_CLIENT;
        if (!webClient)
            throw new BillingCheckoutError("billing_provider_unavailable", 503);
        const portal = await provider.createPortalSession({
            customerId: customer.providerCustomerId,
            returnUrl: `${new URL(webClient).origin}/organizations?tab=plan&organization=${encodeURIComponent(organization.publicId)}`,
        });
        return { portalUrl: portal.portalUrl };
    } catch (error) {
        if (error instanceof BillingCheckoutError) throw error;
        throw new BillingCheckoutError("billing_provider_unavailable", 503);
    }
}
