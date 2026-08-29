import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import {
    billingCatalogRevisions,
    billingWebhookEvents,
    organizationPlanStates,
    organizationSubscriptions,
    organizations,
    teams,
} from "../src/db/schema";
import { readBillingConfig } from "../src/billing/catalog";
import {
    abandonCatalogRevision,
    recordRequestedCatalogRevision,
    verifyCatalogAgainstProvider,
} from "../src/billing/catalog-store";
import { getBillingProvider } from "../src/billing/provider-registry";
import { applyCanonicalBillingEvent } from "../src/billing/webhooks/processor";
import {
    applyTeamSendingControl,
    releaseTeamSendingControl,
} from "../src/billing/reputation";
import { decryptBillingValue } from "../src/billing/crypto";
import { recordBillingMetric } from "../src/billing/metrics";

function usage(): never {
    console.error(`Usage:
  billing catalog-status
  billing catalog-verify
  billing catalog-abandon <revision> --reason <text>
  billing reconcile-org <organization_public_id>
  billing webhook-retry <provider_event_id>
  billing webhook-inspect <provider_event_id>
  billing set-override <organization_public_id> --teams <n>|none --contacts <n>|none --reason <text>
  billing reputation-apply <team_public_id> <warned|marketing_paused|all_paused> --operator <user_id> --reason <text>
  billing reputation-release <team_public_id> --operator <user_id> --reason <text>
  billing cancel-subscription <organization_public_id> --reason <text>
`);
    process.exit(1);
}

function arg(flag: string, argv: string[]): string | undefined {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    return argv[index + 1];
}

async function catalogStatus() {
    const config = readBillingConfig();
    const rows = await db.select().from(billingCatalogRevisions);
    console.log(
        JSON.stringify(
            {
                config: {
                    mode: config.deploymentMode,
                    revision: config.catalogRevision,
                    provider: config.checkoutProvider,
                },
                revisions: rows,
            },
            null,
            2,
        ),
    );
}

async function catalogVerify() {
    const config = readBillingConfig();
    await recordRequestedCatalogRevision(config);
    if (config.deploymentMode !== "cloud") {
        console.log("oss mode: nothing to verify");
        return;
    }
    const provider = getBillingProvider(config.checkoutProvider ?? undefined);
    await verifyCatalogAgainstProvider(config, provider);
    console.log("catalog verified");
}

async function catalogAbandon(
    revisionRaw: string | undefined,
    reason: string | undefined,
) {
    if (!revisionRaw || !reason) usage();
    const revision = Number(revisionRaw);
    if (!Number.isSafeInteger(revision) || revision <= 0) usage();
    const ok = await abandonCatalogRevision(revision, reason);
    if (!ok) {
        console.error("revision not found");
        process.exit(1);
    }
    console.log("abandoned", revision);
}

async function reconcileOrg(publicId: string | undefined) {
    if (!publicId) usage();
    const [organization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.organizationId, publicId))
        .limit(1);
    if (!organization) {
        console.error("organization not found");
        process.exit(1);
    }
    const [subscription] = await db
        .select()
        .from(organizationSubscriptions)
        .where(
            and(
                eq(organizationSubscriptions.organizationId, organization.id),
                eq(organizationSubscriptions.isEntitlementSource, true),
            ),
        )
        .limit(1);
    if (!subscription) {
        console.log("no entitlement-bearing subscription");
        return;
    }
    const provider = getBillingProvider(subscription.provider);
    const snapshot = await provider.retrieveSubscription(
        subscription.providerSubscriptionId,
    );
    await applyCanonicalBillingEvent({
        provider: subscription.provider,
        providerEventId: `operator-reconcile:${subscription.id}:${new Date().toISOString()}`,
        eventType: "subscription.reconciled",
        occurredAt: snapshot.occurredAt,
        subscriptionId: snapshot.providerSubscriptionId,
        snapshot,
        rawPayload: null,
    });
    console.log("reconciled", publicId);
}

async function webhookRetry(eventId: string | undefined) {
    if (!eventId) usage();
    const [event] = await db
        .select()
        .from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, eventId))
        .limit(1);
    if (!event) {
        console.error("event not found");
        process.exit(1);
    }
    await db
        .update(billingWebhookEvents)
        .set({
            status: "pending",
            availableAt: new Date(),
            lockedAt: null,
            leaseExpiresAt: null,
        })
        .where(eq(billingWebhookEvents.id, event.id));
    const { processBillingWebhookInboxEvent } =
        await import("../src/billing/webhooks/processor.js");
    await processBillingWebhookInboxEvent(event.id);
    console.log("retried", eventId);
}

async function webhookInspect(eventId: string | undefined) {
    if (!eventId) usage();
    const [event] = await db
        .select()
        .from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, eventId))
        .limit(1);
    if (!event) {
        console.error("event not found");
        process.exit(1);
    }
    let payload: unknown = null;
    if (event.payloadEncrypted) {
        payload = JSON.parse(decryptBillingValue(event.payloadEncrypted));
    }
    console.log(
        JSON.stringify(
            {
                id: event.id,
                status: event.status,
                eventType: event.eventType,
                lastError: event.lastError,
                payload,
            },
            null,
            2,
        ),
    );
    recordBillingMetric("billing.operator.webhook_decrypt", {
        provider_event_id: eventId,
    });
}

async function setOverride(
    publicId: string | undefined,
    teamsRaw: string | undefined,
    contactsRaw: string | undefined,
    reason: string | undefined,
) {
    if (!publicId || !reason) usage();
    const [organization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.organizationId, publicId))
        .limit(1);
    if (!organization) {
        console.error("organization not found");
        process.exit(1);
    }
    const parse = (raw: string | undefined) => {
        if (raw === undefined || raw === "none") return null;
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value <= 0) usage();
        return value;
    };
    await db
        .update(organizationPlanStates)
        .set({
            teamsLimitOverride: parse(teamsRaw),
            contactsLimitOverride: parse(contactsRaw),
            updatedAt: new Date(),
        })
        .where(eq(organizationPlanStates.organizationId, organization.id));
    recordBillingMetric("billing.operator.override", {
        organization_public_id: publicId,
        reason,
    });
    console.log("overrides updated");
}

async function reputationApply(
    teamPublicId: string | undefined,
    status: string | undefined,
    operator: string | undefined,
    reason: string | undefined,
) {
    if (!teamPublicId || !status || !operator || !reason) usage();
    if (
        status !== "warned" &&
        status !== "marketing_paused" &&
        status !== "all_paused"
    ) {
        usage();
    }
    const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.teamId, teamPublicId))
        .limit(1);
    if (!team) {
        console.error("team not found");
        process.exit(1);
    }
    const ok = await applyTeamSendingControl(team.id, status, operator, reason);
    console.log(ok ? "applied" : "not applied");
}

async function reputationRelease(
    teamPublicId: string | undefined,
    operator: string | undefined,
    reason: string | undefined,
) {
    if (!teamPublicId || !operator || !reason) usage();
    const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.teamId, teamPublicId))
        .limit(1);
    if (!team) {
        console.error("team not found");
        process.exit(1);
    }
    const ok = await releaseTeamSendingControl(team.id, operator, reason);
    console.log(ok ? "released" : "not released");
}

async function cancelSubscription(
    publicId: string | undefined,
    reason: string | undefined,
) {
    if (!publicId || !reason) usage();
    const [organization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.organizationId, publicId))
        .limit(1);
    if (!organization) {
        console.error("organization not found");
        process.exit(1);
    }
    const [subscription] = await db
        .select()
        .from(organizationSubscriptions)
        .where(
            and(
                eq(organizationSubscriptions.organizationId, organization.id),
                eq(organizationSubscriptions.isEntitlementSource, true),
            ),
        )
        .limit(1);
    if (!subscription) {
        console.error("no live subscription");
        process.exit(1);
    }
    const provider = getBillingProvider(subscription.provider);
    await provider.cancelSubscription(
        subscription.providerSubscriptionId,
        `operator-cancel:${subscription.id}`,
    );
    recordBillingMetric("billing.operator.cancel_subscription", {
        organization_public_id: publicId,
        reason,
    });
    console.log(
        "provider cancellation requested; wait for webhook/reconciliation",
    );
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    try {
        if (command === "catalog-status") await catalogStatus();
        else if (command === "catalog-verify") await catalogVerify();
        else if (command === "catalog-abandon")
            await catalogAbandon(rest[0], arg("--reason", rest));
        else if (command === "reconcile-org") await reconcileOrg(rest[0]);
        else if (command === "webhook-retry") await webhookRetry(rest[0]);
        else if (command === "webhook-inspect") await webhookInspect(rest[0]);
        else if (command === "set-override")
            await setOverride(
                rest[0],
                arg("--teams", rest),
                arg("--contacts", rest),
                arg("--reason", rest),
            );
        else if (command === "reputation-apply")
            await reputationApply(
                rest[0],
                rest[1],
                arg("--operator", rest),
                arg("--reason", rest),
            );
        else if (command === "reputation-release")
            await reputationRelease(
                rest[0],
                arg("--operator", rest),
                arg("--reason", rest),
            );
        else if (command === "cancel-subscription")
            await cancelSubscription(rest[0], arg("--reason", rest));
        else usage();
    } finally {
        await pool.end();
    }
}

void main();
