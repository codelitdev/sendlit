import { check, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { genId } from "./id";
import { organizations, user } from "./schema-core";
import { billingCheckoutAttempts } from "./billing.generated";

/** SendLit trial-abuse claims. Not a canonical billing table. */
export const billingTrialClaims = pgTable(
    "billing_trial_claims",
    {
        id: uuid("id").$defaultFn(genId).primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "restrict" }),
        verifiedEmailFingerprint: text("verified_email_fingerprint").notNull(),
        fingerprintKeyVersion: text("fingerprint_key_version").notNull(),
        trialKey: text("trial_key").notNull(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "restrict" }),
        checkoutAttemptId: uuid("checkout_attempt_id").references(
            () => billingCheckoutAttempts.id,
            { onDelete: "restrict" },
        ),
        status: text("status").notNull().default("reserved"),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => ({
        userTrialUnique: uniqueIndex("billing_trial_claims_user_trial_uidx")
            .on(table.userId, table.trialKey)
            .where(sql`${table.status} <> 'released'`),
        emailTrialUnique: uniqueIndex("billing_trial_claims_email_trial_uidx")
            .on(table.verifiedEmailFingerprint, table.trialKey)
            .where(sql`${table.status} <> 'released'`),
        statusCheck: check(
            "billing_trial_claims_status_check",
            sql`${table.status} IN ('reserved', 'redeemed', 'released')`,
        ),
    }),
);
