import logger from "../services/log";
import { processOngoingSequences } from "./process-ongoing-sequences";
import { processRules } from "./process-rules";

export function startAutomation() {
    processOngoingSequences().catch((err) => {
        logger.error({ error: err.message }, "processOngoingSequences crashed");
    });
    processRules().catch((err) => {
        logger.error({ error: err.message }, "processRules crashed");
    });
}
