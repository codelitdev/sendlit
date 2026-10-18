import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: [
        "./src/db/schema-core.ts",
        "./src/db/billing.generated.ts",
        "./src/db/billing-extensions.ts",
    ],
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DB_CONNECTION_STRING || "",
    },
});
