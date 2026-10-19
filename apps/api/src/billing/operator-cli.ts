import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  billingReconciliationJobs,
  billingSubscriptions,
  organizationPlanPolicies,
  organizations,
  teams,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "../organization/audit";
import { readBillingConfig } from "./catalog";
import { getBillingOperations } from "./engine";
import { recordBillingMetric } from "./metrics";
import { applyTeamSendingControl, releaseTeamSendingControl } from "./reputation";

type Operations = ReturnType<typeof getBillingOperations>;

export type BillingCliIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Injected in tests; defaults to the configured engine's operations. */
  operations?: () => Operations;
  now?: () => Date;
};

class UsageError extends Error {}

export const BILLING_CLI_USAGE = `Usage:
  billing health
  billing catalog-status
  billing catalog-verify
  billing catalog-abandon <revision> --operator <id> --reason <text>
  billing inspect-org <organization_public_id>
  billing reconcile-org <organization_public_id> --operator <id> [--reason <text>]
  billing reconcile-cancellations [--dry-run]
  billing reconcile-cancellations --apply --operator <id> [--reason <text>]
  billing webhook-retry <provider_event_id> --operator <id> [--reason <text>] [--new-budget]
  billing webhook-inspect <provider_event_id> --operator <id> --reason <text>
  billing set-override <organization_public_id> --teams <n>|none --contacts <n>|none --operator <id> --reason <text>
  billing reputation-apply <team_public_id> <warned|marketing_paused|all_paused> --operator <id> --reason <text>
  billing reputation-release <team_public_id> --operator <id> --reason <text>
  billing cancel-subscription <organization_public_id> --operator <id> --reason <text>`;

function arg(flag: string, argv: string[]): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function required(value: string | undefined): string {
  if (!value?.trim()) throw new UsageError();
  return value.trim();
}

function operatorContext(argv: string[], defaultReason?: string) {
  return {
    actorId: required(arg("--operator", argv)),
    reason: required(arg("--reason", argv) ?? defaultReason),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function organizationByPublicId(publicId: string | undefined) {
  const [organization] = await db
    .select({ id: organizations.id, organizationId: organizations.organizationId })
    .from(organizations)
    .where(eq(organizations.organizationId, required(publicId)))
    .limit(1);
  if (!organization) throw new Error("organization_not_found");
  return organization;
}

/**
 * Pre-deploy safety for 0.4.1 (README "Billing operations"). alpha.3 kept a
 * subscription paid while the provider said active, even after its scheduled
 * cancellation date; 0.4.1's first deadline batch releases those. A stale row
 * (renewed or resumed at the provider, webhook missed) would be downgraded
 * wrongly, so every entitlement-source subscription with
 * `cancel_at_period_end` is re-read from the provider first. Dry run by
 * default; `--apply --operator <id>` reconciles.
 */
async function reconcileCancellations(argv: string[], io: Required<BillingCliIo>) {
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) throw new UsageError();
  const context = apply
    ? operatorContext(argv, "pre-deploy reconcile of scheduled cancellations")
    : null;
  const now = io.now();
  // Narrow reads: the engine has no public list of scheduled cancellations.
  const rows = await db
    .select({
      subscriptionId: billingSubscriptions.id,
      organizationId: organizations.organizationId,
      provider: billingSubscriptions.provider,
      status: billingSubscriptions.status,
      paidThroughAt: billingSubscriptions.paidThroughAt,
      lastReconciledAt: billingSubscriptions.lastReconciledAt,
    })
    .from(billingSubscriptions)
    .innerJoin(
      organizations,
      eq(organizations.id, billingSubscriptions.billableEntityId),
    )
    .where(
      and(
        eq(billingSubscriptions.isEntitlementSource, true),
        eq(billingSubscriptions.cancelAtPeriodEnd, true),
      ),
    )
    .orderBy(asc(billingSubscriptions.paidThroughAt), asc(billingSubscriptions.id));
  const scheduled = rows.map((row) => ({
    ...row,
    paidThroughAt: row.paidThroughAt?.toISOString() ?? null,
    lastReconciledAt: row.lastReconciledAt?.toISOString() ?? null,
    paidThroughPassed: Boolean(
      row.paidThroughAt && row.paidThroughAt.getTime() <= now.getTime(),
    ),
  }));
  const queuedCancellationJobs = (
    await db
      .select({
        jobId: billingReconciliationJobs.id,
        subscriptionId: billingReconciliationJobs.subscriptionId,
        status: billingReconciliationJobs.status,
        attemptCount: billingReconciliationJobs.attemptCount,
        availableAt: billingReconciliationJobs.availableAt,
        lastError: billingReconciliationJobs.lastError,
      })
      .from(billingReconciliationJobs)
      .where(
        and(
          eq(billingReconciliationJobs.operation, "cancellation"),
          inArray(billingReconciliationJobs.status, [
            "pending",
            "failed",
            "processing",
          ]),
        ),
      )
      .orderBy(asc(billingReconciliationJobs.availableAt))
  ).map((job) => ({ ...job, availableAt: job.availableAt.toISOString() }));
  const report = {
    mode: apply ? "apply" : "dry-run",
    checkedAt: now.toISOString(),
    scheduledCancellations: scheduled.length,
    paidThroughPassed: scheduled.filter((row) => row.paidThroughPassed).length,
    subscriptions: scheduled,
    queuedCancellationJobs,
    notes: [
      "Rows with paidThroughPassed lose paid access on the first deadline batch unless the provider says otherwise.",
      ...(queuedCancellationJobs.length > 0
        ? [
            "Queued alpha.3 cancellation jobs now schedule cancellation at the period end when retried, instead of ending the subscription immediately. Review them with the provider before deploying.",
          ]
        : []),
    ],
  };
  if (!apply || !context) {
    io.out(json(report));
    io.out(
      "Dry run: nothing changed. Re-run with --apply --operator <id> to reconcile every subscription above with the provider.",
    );
    return 0;
  }
  const operations = io.operations();
  const results: { subscriptionId: string; ok: boolean; error?: string }[] = [];
  for (const row of scheduled) {
    try {
      await operations.reconcileSubscription(context, row.subscriptionId);
      results.push({ subscriptionId: row.subscriptionId, ok: true });
    } catch (error) {
      results.push({
        subscriptionId: row.subscriptionId,
        ok: false,
        error: (error as { code?: string }).code ?? (error as Error).message,
      });
    }
  }
  const ids = scheduled.map((row) => row.subscriptionId);
  const after =
    ids.length === 0
      ? []
      : await db
          .select({
            subscriptionId: billingSubscriptions.id,
            status: billingSubscriptions.status,
            cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
            paidThroughAt: billingSubscriptions.paidThroughAt,
            isEntitlementSource: billingSubscriptions.isEntitlementSource,
            lastReconciledAt: billingSubscriptions.lastReconciledAt,
          })
          .from(billingSubscriptions)
          .where(inArray(billingSubscriptions.id, ids));
  io.out(json({ ...report, results, after }));
  return results.every((row) => row.ok) ? 0 : 1;
}

async function run(
  command: string | undefined,
  rest: string[],
  io: Required<BillingCliIo>,
): Promise<number> {
  const ops = () => io.operations();
  switch (command) {
    case "health": {
      io.out(json(await ops().health()));
      return 0;
    }
    case "catalog-status": {
      const config = readBillingConfig();
      const operations = ops();
      io.out(
        json({
          config: {
            mode: config.deploymentMode,
            revision: config.catalogRevision,
            provider: config.checkoutProvider,
          },
          revisions: await operations.catalogRevisions(),
          activeCatalog: await operations.catalog(),
        }),
      );
      return 0;
    }
    case "catalog-verify": {
      const config = readBillingConfig();
      if (config.deploymentMode !== "cloud") {
        io.out("oss mode: nothing to verify");
        return 0;
      }
      const operations = ops();
      await operations.recordRequestedCatalog();
      const result = await operations.verifyRequestedCatalog();
      io.out(json(result));
      return result.verified ? 0 : 1;
    }
    case "catalog-abandon": {
      const revision = Number(required(rest[0]));
      const context = operatorContext(rest);
      const config = readBillingConfig();
      if (!Number.isSafeInteger(revision) || revision <= 0) throw new UsageError();
      if (revision !== config.catalogRevision) {
        // No public API abandons a revision other than the requested one.
        io.err(
          `only the requested revision (${config.catalogRevision}) can be abandoned`,
        );
        return 1;
      }
      const abandoned = await ops().abandonRequestedCatalog(context);
      recordBillingMetric("billing.catalog.abandoned", {
        revision,
        reason: context.reason,
        status: abandoned.status,
      });
      io.out(json(abandoned));
      return 0;
    }
    case "inspect-org": {
      const organization = await organizationByPublicId(rest[0]);
      io.out(json(await ops().inspectEntity(organization.id)));
      return 0;
    }
    case "reconcile-org": {
      const organization = await organizationByPublicId(rest[0]);
      const context = operatorContext(rest, "cli reconcile-org");
      await ops().reconcileEntity(context, organization.id);
      io.out(`reconciled ${organization.organizationId}`);
      return 0;
    }
    case "reconcile-cancellations":
      return reconcileCancellations(rest, io);
    case "webhook-retry": {
      const eventId = required(rest[0]);
      const context = operatorContext(rest, "cli webhook-retry");
      // retryWebhook drains the inbox itself.
      await ops().retryWebhook(
        context,
        eventId,
        rest.includes("--new-budget") ? "new_budget" : "preserve_attempts",
      );
      io.out(`retried ${eventId}`);
      return 0;
    }
    case "webhook-inspect": {
      const eventId = required(rest[0]);
      const context = operatorContext(rest);
      const operations = ops();
      const event = await operations.inspectWebhook(eventId);
      // Audited decryption (operator, reason).
      const payload = event.hasPayload
        ? JSON.parse(await operations.inspectWebhookReplay(context, eventId))
        : null;
      io.out(json({ ...event, payload }));
      recordBillingMetric("billing.operator.webhook_decrypt", {
        provider_event_id: eventId,
      });
      return 0;
    }
    case "set-override": {
      const organization = await organizationByPublicId(rest[0]);
      const context = operatorContext(rest);
      const parse = (raw: string | undefined) => {
        if (raw === undefined || raw === "none") return null;
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value <= 0) throw new UsageError();
        return value;
      };
      const teamsLimitOverride = parse(arg("--teams", rest));
      const contactsLimitOverride = parse(arg("--contacts", rest));
      // SendLit's own plan policy, not paid state.
      await db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .insert(organizationPlanPolicies)
          .values({
            organizationId: organization.id,
            teamsLimitOverride,
            contactsLimitOverride,
          })
          .onConflictDoUpdate({
            target: organizationPlanPolicies.organizationId,
            set: { teamsLimitOverride, contactsLimitOverride, updatedAt: now },
          });
        await recordOrganizationAuditEvent(tx, {
          organizationId: organization.id,
          actor: { type: "system" },
          action: "billing.override_set",
          metadata: {
            operatorId: context.actorId,
            reason: context.reason,
            teamsLimitOverride,
            contactsLimitOverride,
          },
        });
      });
      recordBillingMetric("billing.operator.override", {
        organization_public_id: organization.organizationId,
        reason: context.reason,
      });
      io.out("overrides updated");
      return 0;
    }
    case "reputation-apply": {
      const status = rest[1];
      const context = operatorContext(rest);
      if (
        status !== "warned" &&
        status !== "marketing_paused" &&
        status !== "all_paused"
      ) {
        throw new UsageError();
      }
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.teamId, required(rest[0])))
        .limit(1);
      if (!team) throw new Error("team_not_found");
      const ok = await applyTeamSendingControl(
        team.id,
        status,
        context.actorId,
        context.reason,
      );
      io.out(ok ? "applied" : "not applied");
      return 0;
    }
    case "reputation-release": {
      const context = operatorContext(rest);
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.teamId, required(rest[0])))
        .limit(1);
      if (!team) throw new Error("team_not_found");
      const ok = await releaseTeamSendingControl(
        team.id,
        context.actorId,
        context.reason,
      );
      io.out(ok ? "released" : "not released");
      return 0;
    }
    case "cancel-subscription": {
      const organization = await organizationByPublicId(rest[0]);
      const context = operatorContext(rest);
      // Narrow read: there is no entity-level operator cancel (upstream gap).
      const [subscription] = await db
        .select({ id: billingSubscriptions.id })
        .from(billingSubscriptions)
        .where(
          and(
            eq(billingSubscriptions.billableEntityId, organization.id),
            eq(billingSubscriptions.isEntitlementSource, true),
          ),
        )
        .limit(1);
      if (!subscription) {
        io.err("no live subscription");
        return 1;
      }
      await ops().requestCancellation(context, subscription.id);
      recordBillingMetric("billing.operator.cancel_subscription", {
        organization_public_id: organization.organizationId,
        reason: context.reason,
      });
      io.out(
        "cancellation scheduled at the end of the paid period; paid access continues until then. To end it immediately, cancel in the Dodo dashboard.",
      );
      return 0;
    }
    default:
      throw new UsageError();
  }
}

/** Runs one operator command. Returns the process exit code. */
export async function runBillingCli(argv: string[], io: BillingCliIo): Promise<number> {
  const resolved: Required<BillingCliIo> = {
    out: io.out,
    err: io.err,
    operations: io.operations ?? getBillingOperations,
    now: io.now ?? (() => new Date()),
  };
  const [command, ...rest] = argv;
  try {
    return await run(command, rest, resolved);
  } catch (error) {
    if (error instanceof UsageError) {
      resolved.err(BILLING_CLI_USAGE);
      return 2;
    }
    resolved.err(
      `error: ${(error as { code?: string }).code ?? (error as Error).message}`,
    );
    return 1;
  }
}
