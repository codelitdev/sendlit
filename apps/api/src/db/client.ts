import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { dbConnectionString } from "../config/constants";
import logger from "../services/log";

if (!dbConnectionString) {
    logger.error("DB_CONNECTION_STRING is not defined");
    process.exit(1);
}

export const pool = new Pool({ connectionString: dbConnectionString });

export const db = drizzle(pool, { schema });

export async function checkDatabaseConnection(): Promise<void> {
    await pool.query("select 1");
    logger.info("Database connected");
}
