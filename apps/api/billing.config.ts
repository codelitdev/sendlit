import { defineBillingConfig } from "@codelitdev/billing/config";

/** Schema description for `codelit-billing generate`. Output is committed and
 * applied through drizzle-kit; SendLit does not hand-write canonical tables.
 * No `additionalFields`: SendLit's plan policy lives in its own tables
 * (`organization_plan_policies`, `trial_claims`). */
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
  requiredOfferKeys: ["pro_month", "pro_year", "business_month", "business_year"],
});
