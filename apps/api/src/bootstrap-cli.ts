import { config as loadDotFile } from "dotenv";
loadDotFile();

import { createInitialOrganizationOwnerIfMissing } from "./bootstrap.js";
import { pool } from "./db/client.js";
import logger from "./services/log.js";

/**
 * One-shot container entrypoint. It runs after migrations and creates the
 * configured initial organization owner, default team, and any configured
 * organization API keys supplied through environment configuration.
 */
createInitialOrganizationOwnerIfMissing()
    .catch((error) => {
        logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            "Failed to bootstrap the initial organization owner",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
