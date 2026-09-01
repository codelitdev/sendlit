import { createBilling } from "@codelitdev/billing/workflows";
import { createDrizzleBillingStore } from "@codelitdev/billing/drizzle";
import { createOperations } from "@codelitdev/billing/operations";
import { systemClock } from "@codelitdev/billing/core";
import { db } from "../db/client";
import * as billingSchema from "../db/billing.generated";
import { recordOrganizationAuditEvent } from "../organization/audit";
import { encryptBillingValue, decryptBillingValue } from "./crypto";
import { getBillingProvider } from "./provider-registry";
import { readBillingConfig, toPackageOffer } from "./catalog";
import { applySendLitProjectionEffects } from "./product-effects";
import { sendlitBillingAuthorization } from "./authorization-port";

const clock = systemClock;

function returnUrlAllowed(url: string): boolean {
    const webClient = process.env.WEB_CLIENT || "http://localhost:3000";
    try {
        return new URL(url).origin === new URL(webClient).origin;
    } catch {
        return false;
    }
}

const audit = {
    async record(event: {
        effectId: string;
        actor: { kind: string; id: string };
        reason?: string;
        previous: unknown;
        next: unknown;
        correlationIds: Record<string, string>;
    }) {
        const organizationId =
            event.correlationIds.organizationId ??
            (typeof (event.next as { billableEntityId?: string } | null)
                ?.billableEntityId === "string"
                ? (event.next as { billableEntityId: string }).billableEntityId
                : null);
        if (!organizationId) return;
        await recordOrganizationAuditEvent(db, {
            organizationId,
            actor: {
                type: event.actor.kind === "user" ? "user" : "system",
                id: event.actor.kind === "user" ? event.actor.id : null,
            },
            action: event.effectId.split(":")[0] ?? "billing.effect",
            metadata: {
                effectId: event.effectId,
                reason: event.reason ?? null,
                correlationIds: event.correlationIds,
            },
        });
    },
};

const sensitiveValues = {
    async encrypt(plaintext: string) {
        return {
            ciphertext: encryptBillingValue(plaintext),
            keyVersion: process.env.BILLING_DATA_ENCRYPTION_KEY_VERSION || "v1",
        };
    },
    async decrypt(
        ciphertext: string,
        _context: { operatorActorId: string; reason: string },
    ) {
        return decryptBillingValue(ciphertext);
    },
};

let engine: ReturnType<typeof createBilling> | undefined;

export function getBillingEngine() {
    if (engine && !process.env.VITEST) return engine;
    const config = readBillingConfig();
    const cloud = config.deploymentMode === "cloud";
    const store = createDrizzleBillingStore(db as never, {
        schema: billingSchema,
        clock,
        planStateDefaults: {
            plan: "free",
            rampStage: 0,
            rampCleanStageDays: 0,
        },
        checkoutApplicationFields: {
            toColumns: (fields) => ({
                pendingTeamName:
                    typeof fields.pendingTeamName === "string"
                        ? fields.pendingTeamName
                        : null,
            }),
            fromRow: (row) => ({
                pendingTeamName: row.pendingTeamName ?? null,
            }),
        },
    });
    engine = createBilling({
        database: store,
        providers: cloud ? [getBillingProvider()] : [],
        clock,
        authorization: sendlitBillingAuthorization,
        sensitiveValues,
        hooks: cloud
            ? {
                  audit,
                  lifecycle: {
                      afterProjection: (input) =>
                          applySendLitProjectionEffects(
                              input,
                              store.getTransaction() ?? db,
                          ),
                  },
              }
            : undefined,
        mode: config.deploymentMode,
        checkoutProvider: cloud ? (config.checkoutProvider ?? "dodo") : "",
        requestedRevision: cloud ? config.catalogRevision : null,
        requiredOfferKeys: cloud
            ? ["pro_month", "pro_year", "business_month", "business_year"]
            : [],
        offers: cloud ? config.offers.map(toPackageOffer) : [],
        returnUrlValidator: cloud ? returnUrlAllowed : undefined,
    });
    return engine;
}

export function getBillingOperations() {
    const config = readBillingConfig();
    return createOperations({
        billing: getBillingEngine(),
        clock,
        requestedRevision: config.catalogRevision,
        checkoutProvider: config.checkoutProvider ?? undefined,
        sensitiveValues,
    });
}

export function preconsumedGrant(
    action: "checkout" | "portal" | "plan_change" | "cancellation",
    organizationId: string,
    actorId: string,
) {
    const now = clock.now();
    return {
        grantId: `preconsumed:${action}:${organizationId}:${now.getTime()}`,
        actorId,
        action,
        target: { kind: "organization", id: organizationId },
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    };
}
