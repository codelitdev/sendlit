import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import { db, pool } from "./client.js";
import logger from "../services/log.js";

const migrationsFolder =
    process.env.MIGRATIONS_FOLDER ||
    (existsSync("apps/api/drizzle") ? "apps/api/drizzle" : "drizzle");

migrate(db, { migrationsFolder })
    .then(async () => {
        logger.info({ migrationsFolder }, "Database migrations applied");
    })
    .catch((err) => {
        logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            "Failed to apply database migrations",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
