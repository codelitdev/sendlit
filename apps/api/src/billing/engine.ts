import os from "node:os";
import { systemClock } from "@codelitdev/billing/core";
import {
  createDrizzleBillingStore,
  type DrizzleBillingStore,
} from "@codelitdev/billing/drizzle";
import { createOperations } from "@codelitdev/billing/operations";
import type { BillingProviderAdapter } from "@codelitdev/billing/providers";
import {
  type AuditRecord,
  type BillingEngine,
  createBilling,
  type SensitiveValuePort,
} from "@codelitdev/billing/workflows";
import {
  createAesGcmSensitiveValues,
  createBillingActionGrants,
  createReturnUrlValidator,
} from "@codelitdev/platform/billing";
import { drizzleVerificationGrantStore } from "@codelitdev/platform/billing/drizzle";
import { eq } from "drizzle-orm";
import * as billingSchema from "../db/billing.generated";
import { db } from "../db/client";
import {
  billingCheckoutAttempts,
  billingPlanChangeAttempts,
  billingSubscriptions,
  verification,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "../organization/audit";
import logger from "../services/log";
import { billingCatalogKeys, readBillingConfig, toPackageOffer } from "./catalog";
import { applySendLitProjectionEffects } from "./product-effects";
import { getBillingProvider } from "./provider-registry";
import { releaseTrialClaimsForAbandonedCheckouts } from "./trial-claims";

const clock = systemClock;

type QueryDb = Pick<typeof db, "select" | "insert" | "update">;

/** Unique per process. Billing leases are owned by worker ID, and containers
 * often all run as PID 1, so the hostname is part of it. */
export function billingWorkerId(role = "billing"): string {
  return `sendlit-${role}-${os.hostname()}-${process.pid}`;
}

let sensitiveValues: SensitiveValuePort | undefined;

/** AES-256-GCM port for checkout URLs, plan-change payment URLs and webhook
 * payloads. The ciphertext format is identical to SendLit's previous
 * `crypto.ts`, so stored values stay readable. Built only in cloud mode
 * (it throws when the key is missing or malformed). */
export function getBillingSensitiveValues(
  env: NodeJS.ProcessEnv = process.env,
): SensitiveValuePort {
  if (sensitiveValues && env === process.env && process.env.NODE_ENV !== "test") {
    return sensitiveValues;
  }
  const key = env.BILLING_DATA_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("BILLING_DATA_ENCRYPTION_KEY_missing");
  const port = createAesGcmSensitiveValues({
    key,
    previousKeys: (env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    // aesGcmSensitiveValuesFromEnv always writes "v1"; keep the configured
    // version so `payload_key_version` metadata stays continuous.
    keyVersion: env.BILLING_DATA_ENCRYPTION_KEY_VERSION?.trim() || "v1",
  });
  if (env === process.env) sensitiveValues = port;
  return port;
}

const DEFAULT_RECENT_AUTH_SECONDS = 900;

/** `BILLING_RECENT_AUTH_MAX_AGE_SECONDS`, or null when it is not a positive
 * integer (token issuance then fails closed). */
export function recentAuthMaxAgeMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.BILLING_RECENT_AUTH_MAX_AGE_SECONDS;
  const seconds = Number(raw ?? DEFAULT_RECENT_AUTH_SECONDS);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

function grantStore() {
  return drizzleVerificationGrantStore(db as never, verification);
}

/** Single-use billing action grants, stored in Better Auth's `verification`
 * table. Issuing requires a session that signed in within
 * BILLING_RECENT_AUTH_MAX_AGE_SECONDS. Instances are stateless, so they are
 * built per call and always reflect the current env. */
export function getBillingActionGrants() {
  return createBillingActionGrants({
    store: grantStore(),
    clock,
    recentAuthMaxAgeMs: recentAuthMaxAgeMs() ?? DEFAULT_RECENT_AUTH_SECONDS * 1000,
  });
}

/**
 * Grants for one path only: finishing checkout for an organization that is
 * still `pending_payment`. SendLit has always let a long-lived session resume
 * that checkout, because the person already passed recent authentication
 * when they created the pending organization and the checkout cannot charge
 * anything the person has not already chosen. Platform's `issue()` always
 * enforces `recentAuthMaxAgeMs` and has no exemption, so this second instance
 * effectively disables the age check. Do not use it for any other action.
 * Tokens are consumed by the same store and JSON format, so the engine's
 * authorization port (from `getBillingActionGrants`) accepts them.
 */
export function getPendingCheckoutResumeGrants() {
  return createBillingActionGrants({
    store: grantStore(),
    clock,
    recentAuthMaxAgeMs: Number.MAX_SAFE_INTEGER,
  });
}

/** Adapters for every enabled provider SendLit can build. The checkout
 * provider must build; others are best effort so an enabled-but-unsupported
 * provider does not take the API down. */
export function configuredBillingProviders(
  config: ReturnType<typeof readBillingConfig> = readBillingConfig(),
): BillingProviderAdapter[] {
  if (config.deploymentMode !== "cloud" || !config.checkoutProvider) return [];
  const adapters = [getBillingProvider(config.checkoutProvider)];
  for (const name of config.enabledProviders) {
    if (name === config.checkoutProvider) continue;
    try {
      adapters.push(getBillingProvider(name));
    } catch (error) {
      logger.warn(
        { billing_provider: name, error: (error as Error).message },
        "enabled billing provider skipped: no adapter",
      );
    }
  }
  return adapters;
}

async function first<T>(rows: Promise<T[]>): Promise<T | undefined> {
  return (await rows)[0];
}

/** Finds the organization an engine audit record belongs to. The engine
 * never sets `correlationIds.organizationId`, and cancellation, resumption,
 * checkout and operator audits carry only row IDs. */
async function auditOrganizationId(
  client: QueryDb,
  event: AuditRecord,
): Promise<string | null> {
  const ids = event.correlationIds;
  if (ids.organizationId) return ids.organizationId;
  if (ids.billableEntityId) return ids.billableEntityId;
  const next = event.next as { billableEntityId?: unknown } | null;
  if (typeof next?.billableEntityId === "string") return next.billableEntityId;
  if (ids.subscriptionId) {
    const row = await first(
      client
        .select({ id: billingSubscriptions.billableEntityId })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, ids.subscriptionId))
        .limit(1),
    );
    if (row) return row.id;
  }
  if (ids.checkoutAttemptId || ids.attemptId) {
    const row = await first(
      client
        .select({ id: billingCheckoutAttempts.billableEntityId })
        .from(billingCheckoutAttempts)
        .where(
          ids.checkoutAttemptId
            ? eq(billingCheckoutAttempts.id, ids.checkoutAttemptId)
            : eq(billingCheckoutAttempts.attemptId, ids.attemptId),
        )
        .limit(1),
    );
    if (row) return row.id;
  }
  if (ids.changeId || ids.planChangeAttemptId) {
    const row = await first(
      client
        .select({ id: billingPlanChangeAttempts.billableEntityId })
        .from(billingPlanChangeAttempts)
        .where(
          ids.changeId
            ? eq(billingPlanChangeAttempts.changeId, ids.changeId)
            : eq(billingPlanChangeAttempts.id, ids.planChangeAttemptId),
        )
        .limit(1),
    );
    if (row) return row.id;
  }
  return null;
}

function auditHook(store: DrizzleBillingStore) {
  return {
    async record(event: AuditRecord) {
      // Write in the engine's transaction (when there is one) so the audit row
      // commits or rolls back with the state change it describes.
      const client = (store.getTransaction() ?? db) as unknown as QueryDb;
      const abandoned = /^checkout:([^:]+):abandoned$/.exec(event.effectId);
      if (abandoned?.[1]) {
        await releaseTrialClaimsForAbandonedCheckouts(client, [abandoned[1]]);
      }
      const organizationId = await auditOrganizationId(client, event);
      if (!organizationId) {
        logger.info(
          { billing_effect: event.effectId, actor: event.actor.kind },
          "billing audit without an organization",
        );
        return;
      }
      await recordOrganizationAuditEvent(client, {
        organizationId,
        actor: {
          type: event.actor.kind === "user" ? "user" : "system",
          id: event.actor.kind === "user" ? event.actor.id : null,
        },
        action: event.effectId.split(":")[0] || "billing.effect",
        metadata: {
          effectId: event.effectId,
          ...(event.actor.kind === "operator" ? { operatorId: event.actor.id } : {}),
          reason: event.reason ?? null,
          correlationIds: event.correlationIds,
        },
      });
    },
  };
}

let engine: BillingEngine | undefined;

/** Clears cached composition (tests and env changes). */
export function resetBillingEngine(): void {
  engine = undefined;
  sensitiveValues = undefined;
}

export function getBillingEngine(): BillingEngine {
  if (engine && process.env.NODE_ENV !== "test") return engine;
  const config = readBillingConfig();
  const cloud = config.deploymentMode === "cloud";
  const store = createDrizzleBillingStore(db as never, {
    schema: billingSchema,
    clock,
  });
  engine = createBilling({
    database: store,
    providers: cloud ? configuredBillingProviders(config) : [],
    clock,
    authorization: getBillingActionGrants().authorization,
    sensitiveValues: cloud ? getBillingSensitiveValues() : undefined,
    hooks: cloud
      ? {
          audit: auditHook(store),
          lifecycle: {
            afterProjection: (input) =>
              applySendLitProjectionEffects(input, store.getTransaction() ?? db),
          },
        }
      : undefined,
    mode: config.deploymentMode,
    checkoutProvider: cloud ? (config.checkoutProvider ?? "dodo") : "",
    requestedRevision: cloud ? config.catalogRevision : null,
    requiredOfferKeys: cloud ? [...billingCatalogKeys] : [],
    offers: cloud ? config.offers.map(toPackageOffer) : [],
    returnUrlValidator: cloud
      ? createReturnUrlValidator([process.env.WEB_CLIENT || "http://localhost:3000"])
      : undefined,
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
    sensitiveValues:
      config.deploymentMode === "cloud" ? getBillingSensitiveValues() : undefined,
  });
}
