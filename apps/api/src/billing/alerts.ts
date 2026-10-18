import { and, eq, inArray, isNull, lt, min, or, sql } from "drizzle-orm";
import { createTransport } from "nodemailer";
import { db } from "../db/client";
import {
    billingCatalogRevisions,
    billingCheckoutAttempts,
    billingProviderCustomers,
    billingWebhookEvents,
    billingSubscriptions,
} from "../db/schema";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import { recordBillingMetric } from "./metrics";

export type BillingAlertCode =
    | "webhook_quarantined"
    | "webhook_inbox_lag"
    | "webhook_signature_spike"
    | "checkout_creating_stuck"
    | "customer_creating_stuck"
    | "subscription_unreconciled"
    | "catalog_invalid"
    | "hourly_job_missed";

export type BillingAlert = {
    code: BillingAlertCode;
    message: string;
    details: Record<string, string | number | null>;
};

const PAGE_COOLDOWN_MS = 30 * 60 * 1000;
const INBOX_LAG_MS = 5 * 60 * 1000;
const STUCK_CREATING_MS = 15 * 60 * 1000;
const UNRECONCILED_MS = 6 * 60 * 60 * 1000;
const HOURLY_MISS_MS = 2 * 60 * 60 * 1000;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const SIGNATURE_SPIKE = 10;

const lastPagedAt = new Map<string, number>();
const signatureFailures: number[] = [];
let lastHourlySuccessAt = Date.now();

export function resetBillingAlertsForTests(): void {
    lastPagedAt.clear();
    signatureFailures.length = 0;
    lastHourlySuccessAt = Date.now();
}

export function recordBillingHourlySuccess(now = new Date()): void {
    lastHourlySuccessAt = now.getTime();
}

export function recordWebhookSignatureFailure(now = new Date()): number {
    signatureFailures.push(now.getTime());
    const cutoff = now.getTime() - SIGNATURE_WINDOW_MS;
    while (
        signatureFailures[0] !== undefined &&
        signatureFailures[0] < cutoff
    ) {
        signatureFailures.shift();
    }
    return signatureFailures.length;
}

function adminRecipients(): string[] {
    const raw = process.env.BILLING_ALERT_EMAIL || "";
    return raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

async function emailAdmins(subject: string, text: string): Promise<void> {
    const to = adminRecipients();
    if (to.length === 0) return;
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_FROM) {
        logger.warn(
            { subject },
            "billing page email skipped: SMTP is not configured",
        );
        return;
    }
    if (process.env.NODE_ENV !== "production") {
        logger.info({ to, subject, text }, "[Dev] billing page");
        return;
    }
    const transporter = createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        auth: process.env.EMAIL_USER
            ? {
                  user: process.env.EMAIL_USER,
                  pass: process.env.EMAIL_PASS || "",
              }
            : undefined,
    });
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: to.join(", "),
        subject,
        text,
    });
}

export async function pageBillingAlert(
    alert: BillingAlert,
    now = new Date(),
): Promise<void> {
    const last = lastPagedAt.get(alert.code) ?? 0;
    if (
        now.getTime() - last < PAGE_COOLDOWN_MS &&
        alert.code !== "webhook_quarantined"
    ) {
        return;
    }
    lastPagedAt.set(alert.code, now.getTime());
    logger.error(
        { billing_alert: alert.code, ...alert.details },
        alert.message,
    );
    recordBillingMetric("billing.page", { code: alert.code, ...alert.details });
    captureEvent({
        event: "billing.page",
        source: "billing.slo",
        properties: { alert_code: alert.code, ...alert.details },
    });
    captureError({
        error: new Error(alert.message),
        source: "billing.slo",
        severity: "critical",
        context: { alert_code: alert.code, error_code: alert.code },
    });
    await emailAdmins(
        `[SendLit billing] ${alert.code}`,
        `${alert.message}\n${JSON.stringify(alert.details)}`,
    );
}

export async function collectBillingSloAlerts(
    now = new Date(),
): Promise<BillingAlert[]> {
    const alerts: BillingAlert[] = [];
    const [oldestPending] = await db
        .select({ receivedAt: min(billingWebhookEvents.receivedAt) })
        .from(billingWebhookEvents)
        .where(
            inArray(billingWebhookEvents.status, [
                "pending",
                "failed",
                "processing",
            ]),
        );
    if (oldestPending?.receivedAt) {
        const ageMs = now.getTime() - oldestPending.receivedAt.getTime();
        if (ageMs >= INBOX_LAG_MS) {
            alerts.push({
                code: "webhook_inbox_lag",
                message:
                    "Billing webhook inbox has a pending event older than five minutes.",
                details: { age_ms: ageMs },
            });
        }
    }

    const [quarantined] = await db
        .select({ value: sql<number>`count(*)` })
        .from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.status, "quarantined"));
    const quarantinedCount = Number(quarantined?.value ?? 0);
    if (quarantinedCount > 0) {
        alerts.push({
            code: "webhook_quarantined",
            message:
                "A billing webhook event is quarantined and needs operator review.",
            details: { count: quarantinedCount },
        });
    }

    const cutoff = now.getTime() - SIGNATURE_WINDOW_MS;
    const spike = signatureFailures.filter((stamp) => stamp >= cutoff).length;
    if (spike >= SIGNATURE_SPIKE) {
        alerts.push({
            code: "webhook_signature_spike",
            message: "Billing webhook signature failures are spiking.",
            details: { count: spike },
        });
    }

    const stuckSince = new Date(now.getTime() - STUCK_CREATING_MS);
    const [stuckCheckout] = await db
        .select({ value: sql<number>`count(*)` })
        .from(billingCheckoutAttempts)
        .where(
            and(
                eq(billingCheckoutAttempts.status, "creating"),
                lt(billingCheckoutAttempts.updatedAt, stuckSince),
            ),
        );
    if (Number(stuckCheckout?.value ?? 0) > 0) {
        alerts.push({
            code: "checkout_creating_stuck",
            message:
                "A billing checkout attempt has been creating for more than 15 minutes.",
            details: { count: Number(stuckCheckout?.value ?? 0) },
        });
    }
    const [stuckCustomer] = await db
        .select({ value: sql<number>`count(*)` })
        .from(billingProviderCustomers)
        .where(
            and(
                eq(billingProviderCustomers.status, "creating"),
                lt(billingProviderCustomers.updatedAt, stuckSince),
            ),
        );
    if (Number(stuckCustomer?.value ?? 0) > 0) {
        alerts.push({
            code: "customer_creating_stuck",
            message:
                "A billing provider customer has been creating for more than 15 minutes.",
            details: { count: Number(stuckCustomer?.value ?? 0) },
        });
    }

    const unreconciledSince = new Date(now.getTime() - UNRECONCILED_MS);
    const [unreconciled] = await db
        .select({ value: sql<number>`count(*)` })
        .from(billingSubscriptions)
        .where(
            and(
                inArray(billingSubscriptions.status, [
                    "pending",
                    "trialing",
                    "active",
                    "past_due",
                    "cancelled",
                ]),
                or(
                    isNull(billingSubscriptions.lastReconciledAt),
                    lt(
                        billingSubscriptions.lastReconciledAt,
                        unreconciledSince,
                    ),
                ),
            ),
        );
    if (Number(unreconciled?.value ?? 0) > 0) {
        alerts.push({
            code: "subscription_unreconciled",
            message:
                "A nonterminal subscription has not reconciled in six hours.",
            details: { count: Number(unreconciled?.value ?? 0) },
        });
    }

    const [invalidCatalog] = await db
        .select({ value: sql<number>`count(*)` })
        .from(billingCatalogRevisions)
        .where(eq(billingCatalogRevisions.status, "invalid"));
    if (Number(invalidCatalog?.value ?? 0) > 0) {
        alerts.push({
            code: "catalog_invalid",
            message:
                "The billing catalog revision is invalid; checkout is frozen.",
            details: { count: Number(invalidCatalog?.value ?? 0) },
        });
    }

    if (now.getTime() - lastHourlySuccessAt >= HOURLY_MISS_MS) {
        alerts.push({
            code: "hourly_job_missed",
            message:
                "The hourly billing reconciliation job has missed two scheduled runs.",
            details: { age_ms: now.getTime() - lastHourlySuccessAt },
        });
    }

    return alerts;
}

export async function evaluateBillingSloAlerts(
    now = new Date(),
): Promise<BillingAlert[]> {
    const alerts = await collectBillingSloAlerts(now);
    for (const alert of alerts) await pageBillingAlert(alert, now);
    return alerts;
}
