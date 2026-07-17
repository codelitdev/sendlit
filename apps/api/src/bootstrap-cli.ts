import { config as loadDotFile } from "dotenv";
loadDotFile();

import { createSuperAdminIfMissing } from "./bootstrap.js";
import { pool } from "./db/client.js";
import logger from "./services/log.js";

/**
 * One-shot container entrypoint. It runs after migrations and creates the
 * configured self-host administrator, default team, and one-time API key.
 */
createSuperAdminIfMissing()
    .catch((error) => {
        logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            "Failed to bootstrap the super admin account",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
