import type { BillingEngine } from "@codelitdev/billing/workflows";
import { startBillingWorkers } from "@codelitdev/platform/billing";
import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { db } from "../db/client";
import { organizations, planSendReservations, sendingDomains } from "../db/schema";
import { captureError } from "../observability";
import logger from "../services/log";
import { evaluateBillingSloAlerts, recordBillingHourlySuccess } from "./alerts";
import { readBillingConfig } from "./catalog";
import { verifySendingDomain } from "./domains";
import { billingWorkerId, getBillingEngine } from "./engine";
import { settleExpiredSendReservation } from "./entitlements";
import { providerErrorSummary } from "./provider";
import { evaluateAllTeamReputations } from "./reputation";

const RESERVATION_INTERVAL_MS = 5 * 1000;
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

/** SendLit quota: settles plan send reservations whose lease expired. Not
 * billing state; runs in every deployment mode. */
export async function settleExpiredSendReservationsOnce(
  now = new Date(),
): Promise<void> {
  const expiredReservations = await db
    .select({ outboundMessageId: planSendReservations.outboundMessageId })
    .from(planSendReservations)
    .where(
      and(
        eq(planSendReservations.state, "reserved"),
        lte(planSendReservations.expiresAt, now),
      ),
    )
    .limit(500);
  for (const reservation of expiredReservations) {
    await settleExpiredSendReservation(reservation.outboundMessageId, now).catch(
      (error) => {
        logger.error(
          {
            outbound_message_id: reservation.outboundMessageId,
            error: providerErrorSummary(error),
          },
          "expired send reservation settlement failed",
        );
      },
    );
  }
}

/** Paid-organization creation is two-phase: a pending organization is kept
 * while checkout can still complete, then tombstoned once no checkout is
 * live. Rows are never deleted, so late provider events cannot reactivate it
 * (see product-effects). */
export async function tombstoneAbandonedPendingOrganizations(
  billing: Pick<BillingEngine, "getBillableEntityBillingBlockers">,
  now = new Date(),
): Promise<number> {
  const pending = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.status, "pending_payment"),
        lt(organizations.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ),
    )
    .limit(100);
  let tombstoned = 0;
  for (const organization of pending) {
    const blockers = await billing.getBillableEntityBillingBlockers(
      { kind: "organization", id: organization.id },
      now,
    );
    if (blockers.includes("live_checkout")) continue;
    const updated = await db
      .update(organizations)
      .set({ status: "abandoned", updatedAt: now })
      .where(
        and(
          eq(organizations.id, organization.id),
          eq(organizations.status, "pending_payment"),
        ),
      )
      .returning({ id: organizations.id });
    tombstoned += updated.length;
  }
  return tombstoned;
}

async function checkDueSendingDomains(now: Date): Promise<void> {
  const dueDomains = await db
    .select({
      organizationId: sendingDomains.organizationId,
      domainId: sendingDomains.domainId,
    })
    .from(sendingDomains)
    .where(
      and(
        inArray(sendingDomains.status, ["pending", "verified", "failed"]),
        lt(sendingDomains.nextCheckAt, now),
      ),
    )
    .limit(100);
  for (const domain of dueDomains) {
    // Claim the check briefly so multiple API instances do not count the
    // same failed DNS lookup several times in one sweep.
    const [claimed] = await db
      .update(sendingDomains)
      .set({
        nextCheckAt: new Date(now.getTime() + 60 * 60 * 1000),
        updatedAt: now,
      })
      .where(
        and(
          eq(sendingDomains.domainId, domain.domainId),
          lt(sendingDomains.nextCheckAt, now),
        ),
      )
      .returning({
        organizationId: sendingDomains.organizationId,
        domainId: sendingDomains.domainId,
      });
    if (claimed) {
      await verifySendingDomain(claimed.organizationId, claimed.domainId).catch(() => {
        logger.warn(
          { sending_domain_check: claimed.domainId },
          "sending domain verification failed",
        );
      });
    }
  }
}

/** SendLit's hourly cloud work. Billing sweeps (inbox, reconciliation,
 * deadlines, stuck-work discovery, retention, catalog verification) belong to
 * the Platform billing workers and are not repeated here. */
export async function runHourlyBillingMaintenance(
  billing: Pick<BillingEngine, "getBillableEntityBillingBlockers">,
  now = new Date(),
): Promise<void> {
  await tombstoneAbandonedPendingOrganizations(billing, now);
  await checkDueSendingDomains(now);
  await evaluateAllTeamReputations(now);
  recordBillingHourlySuccess(now);
  await evaluateBillingSloAlerts(now).catch((error) => {
    logger.error(
      { error: providerErrorSummary(error) },
      "billing SLO evaluation failed",
    );
  });
}

export type BillingMaintenance = {
  /** Stops all timers and waits for work already running. */
  stop(): Promise<void>;
};

type MaintainedBilling = Parameters<typeof startBillingWorkers>[0]["billing"];

/**
 * Starts billing maintenance:
 * - Platform's `startBillingWorkers` (cloud only): catalog verification, the
 *   webhook inbox, reconciliation with stuck-work discovery, deadlines (every
 *   minute) and retention (hourly). Its first batch tick runs one interval
 *   after start, never at boot, so operators can reconcile scheduled
 *   cancellations before the first deadline batch (see README).
 * - SendLit's own loops: send reservation settlement every 5 seconds (all
 *   modes) and the hourly cloud work above (first run at start).
 *
 * `stop()` clears the timers and awaits every in-flight run, including engine
 * calls started by the Platform workers.
 */
export function startBillingMaintenance(
  options: {
    /** Platform worker tick. Default one minute; do not lower it, catalog
     * verification calls the provider once per offer per tick. */
    workerIntervalMs?: number;
    reservationIntervalMs?: number;
    hourlyIntervalMs?: number;
  } = {},
): BillingMaintenance {
  const inFlight = new Set<Promise<unknown>>();
  let stopped = false;
  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    void promise
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(promise);
      });
    return promise;
  };

  let cloud = false;
  try {
    cloud = readBillingConfig().deploymentMode === "cloud";
  } catch {
    cloud = false;
  }

  let workers: { stop(): Promise<void> } | null = null;
  const billing = cloud ? getBillingEngine() : null;
  if (billing) {
    // Wrap the engine so stop() can await calls the workers started without
    // awaiting (the boot-time catalog record and the retention timer).
    const maintained: MaintainedBilling = {
      recordRequestedCatalog: () => track(billing.recordRequestedCatalog()),
      verifyRequestedCatalog: () => track(billing.verifyRequestedCatalog()),
      runWebhookInboxBatch: (input) => track(billing.runWebhookInboxBatch(input)),
      runReconciliationBatch: (input) => track(billing.runReconciliationBatch(input)),
      runDeadlineBatch: (input) => track(billing.runDeadlineBatch(input)),
      purgeExpiredSensitiveValues: (input) =>
        track(billing.purgeExpiredSensitiveValues(input)),
    };
    workers = startBillingWorkers({
      billing: maintained,
      workerId: billingWorkerId(),
      intervalMs: options.workerIntervalMs,
      onError: (task, error) => {
        logger.error(
          { billing_task: task, error: providerErrorSummary(error) },
          "billing maintenance task failed",
        );
        captureError({
          error,
          source: "billing.maintenance",
          context: { task },
        });
      },
    });
  }

  let reservationsRunning = false;
  const reservations = setInterval(() => {
    if (stopped || reservationsRunning) return;
    reservationsRunning = true;
    void track(
      settleExpiredSendReservationsOnce()
        .catch((error) => {
          logger.error(
            { error: providerErrorSummary(error) },
            "send reservation settlement failed",
          );
        })
        .finally(() => {
          reservationsRunning = false;
        }),
    );
  }, options.reservationIntervalMs ?? RESERVATION_INTERVAL_MS);
  reservations.unref?.();

  let hourly: NodeJS.Timeout | undefined;
  if (billing) {
    let hourlyRunning = false;
    const runHourly = () => {
      if (stopped || hourlyRunning) return;
      hourlyRunning = true;
      void track(
        runHourlyBillingMaintenance(billing)
          .catch((error) => {
            logger.error(
              { error: providerErrorSummary(error) },
              "hourly billing maintenance failed",
            );
          })
          .finally(() => {
            hourlyRunning = false;
          }),
      );
    };
    runHourly();
    hourly = setInterval(runHourly, options.hourlyIntervalMs ?? HOURLY_INTERVAL_MS);
    hourly.unref?.();
  }

  return {
    async stop() {
      stopped = true;
      clearInterval(reservations);
      if (hourly) clearInterval(hourly);
      await workers?.stop();
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}
