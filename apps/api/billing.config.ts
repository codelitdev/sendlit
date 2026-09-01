import { defineBillingConfig } from "@codelitdev/billing/config";

/** Schema description for `codelit-billing generate`. Output is committed and
 * applied through drizzle-kit; SendLit does not hand-write canonical tables. */
export default defineBillingConfig({
    dialect: "postgresql",
    adapter: "drizzle",
    output: "./src/db/billing.generated.ts",
    billableEntity: {
        modelName: "organization",
        tableImport: "./schema-core",
        tableExport: "organizations",
        idColumn: "id",
        idType: "uuid",
        onDelete: "restrict",
    },
    payer: {
        modelName: "user",
        tableImport: "./schema-core",
        tableExport: "user",
        idColumn: "id",
        idType: "text",
        onDelete: "restrict",
    },
    planIds: ["pro", "business"],
    requiredOfferKeys: [
        "pro_month",
        "pro_year",
        "business_month",
        "business_year",
    ],
    additionalFields: {
        planStates: {
            plan: { type: "text", nullable: false },
            teamsLimitOverride: { type: "integer", nullable: true },
            contactsLimitOverride: { type: "integer", nullable: true },
            firstPaidActivatedAt: { type: "timestamp", nullable: true },
            rampStage: { type: "integer", nullable: false },
            rampCleanStageDays: { type: "integer", nullable: false },
            rampEvaluatedAt: { type: "timestamp", nullable: true },
        },
        checkoutAttempts: {
            pendingTeamName: { type: "text", nullable: true },
        },
        subscriptions: {
            pastDueAt: { type: "timestamp", nullable: true },
            graceEndsAt: { type: "timestamp", nullable: true },
        },
    },
});
