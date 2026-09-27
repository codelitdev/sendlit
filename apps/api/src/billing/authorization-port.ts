import { and, eq, gt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { BillingWorkflowError } from "@codelitdev/billing/core";
import type {
    BillingActionGrant,
    BillingAuthorizationPort,
} from "@codelitdev/billing/workflows";
import { db } from "../db/client";
import { organizations, verification } from "../db/schema";

type StoredActionToken = {
    userId: string;
    sessionId: string;
    action: string;
    target: string;
};

function tokenHash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

function expectedHttpActions(action: BillingActionGrant["action"]): string[] {
    if (action === "checkout") return ["checkout", "organization_checkout"];
    if (action === "portal") return ["portal"];
    if (action === "plan_change") return ["plan_change"];
    if (action === "cancellation") return ["cancellation"];
    return [action];
}

export const sendlitBillingAuthorization: BillingAuthorizationPort = {
    async consume(grant, expectedAction, expectedTarget, now) {
        if (grant.grantId.startsWith("preconsumed:")) {
            if (
                grant.action !== expectedAction ||
                grant.target.id !== expectedTarget.id
            ) {
                throw new BillingWorkflowError("grant_invalid");
            }
            return;
        }
        const identifier = `billing-action:${tokenHash(grant.grantId)}`;
        const consumed = await db.transaction(async (tx) => {
            const [row] = await tx
                .select()
                .from(verification)
                .where(
                    and(
                        eq(verification.identifier, identifier),
                        gt(verification.expiresAt, now),
                    ),
                )
                .limit(1)
                .for("update");
            if (!row) return false;
            let value: StoredActionToken;
            try {
                value = JSON.parse(row.value) as StoredActionToken;
            } catch {
                return false;
            }
            if (
                value.userId !== grant.actorId ||
                !expectedHttpActions(expectedAction).includes(value.action)
            ) {
                return false;
            }
            if (value.action === "organization_checkout") {
                if (value.target !== "new") return false;
            } else {
                const [organization] = await tx
                    .select({ id: organizations.id })
                    .from(organizations)
                    .where(eq(organizations.organizationId, value.target))
                    .limit(1);
                if (!organization || organization.id !== expectedTarget.id) {
                    return false;
                }
            }
            await tx.delete(verification).where(eq(verification.id, row.id));
            return true;
        });
        if (!consumed) throw new BillingWorkflowError("grant_invalid");
    },
};
