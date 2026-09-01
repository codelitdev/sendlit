import { and, eq } from "drizzle-orm";
import { createTransport } from "nodemailer";
import { db } from "../db/client";
import {
    organizationMembers,
    billingSubscriptions,
    organizations,
    teams,
    user,
} from "../db/schema";
import logger from "../services/log";
import { recordBillingMetric } from "./metrics";

async function platformTransporter() {
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_FROM) return null;
    return createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        auth: process.env.EMAIL_USER
            ? {
                  user: process.env.EMAIL_USER,
                  pass: process.env.EMAIL_PASS || "",
              }
            : undefined,
    });
}

async function recipientsForOrganization(
    organizationId: string,
): Promise<string[]> {
    const [subscription] = await db
        .select({
            payerId: billingSubscriptions.payerId,
        })
        .from(billingSubscriptions)
        .where(
            and(
                eq(billingSubscriptions.billableEntityId, organizationId),
                eq(billingSubscriptions.isEntitlementSource, true),
            ),
        )
        .limit(1);
    const owners = await db
        .select({ email: user.email })
        .from(organizationMembers)
        .innerJoin(user, eq(user.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.role, "owner"),
            ),
        );
    const emails = new Set(
        owners
            .map((row) => row.email)
            .filter((email): email is string => Boolean(email)),
    );
    if (subscription?.payerId) {
        const [manager] = await db
            .select({ email: user.email })
            .from(user)
            .where(eq(user.id, subscription.payerId))
            .limit(1);
        if (manager?.email) emails.add(manager.email);
    }
    return [...emails];
}

async function sendPlatformMail(
    to: string[],
    subject: string,
    text: string,
): Promise<void> {
    if (to.length === 0) return;
    const transporter = await platformTransporter();
    if (!transporter) {
        logger.warn(
            { subject, recipients: to.length },
            "billing notification skipped: platform SMTP is not configured",
        );
        return;
    }
    if (process.env.NODE_ENV !== "production") {
        logger.info({ to, subject, text }, "[Dev] billing notification");
        return;
    }
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: to.join(", "),
        subject,
        text,
    });
}

export async function notifyPaymentPastDue(
    organizationId: string,
    graceEndsAt: Date | null,
): Promise<void> {
    const [organization] = await db
        .select({
            name: organizations.name,
            publicId: organizations.organizationId,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
    if (!organization) return;
    const grace = graceEndsAt
        ? graceEndsAt.toISOString().slice(0, 10)
        : "the end of the seven-day grace period";
    const origin = process.env.WEB_CLIENT
        ? new URL(process.env.WEB_CLIENT).origin
        : "";
    await sendPlatformMail(
        await recipientsForOrganization(organizationId),
        `Payment past due for ${organization.name}`,
        `Payment for ${organization.name} is past due. Paid sending remains available until ${grace}. Update the payment method from Organizations → Plan → Manage billing${origin ? ` (${origin}/organizations?tab=plan&organization=${organization.publicId})` : ""}.`,
    );
    recordBillingMetric("billing.notification.past_due", {
        organization_public_id: organization.publicId,
    });
}

export async function notifyReputationChange(input: {
    organizationId: string;
    teamId: string;
    status: string;
    reason: string;
}): Promise<void> {
    const [organization] = await db
        .select({
            name: organizations.name,
            publicId: organizations.organizationId,
        })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);
    const [team] = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, input.teamId))
        .limit(1);
    if (!organization || !team) return;
    await sendPlatformMail(
        await recipientsForOrganization(input.organizationId),
        `Sending controls updated for ${team.name}`,
        `SendLit applied a fair-use sending control to ${team.name} in ${organization.name}. New status: ${input.status} (${input.reason}). Marketing or all sending may be limited until the list recovers or an operator reviews it.`,
    );
    recordBillingMetric("billing.notification.reputation", {
        organization_public_id: organization.publicId,
        status: input.status,
        reason: input.reason,
    });
}
