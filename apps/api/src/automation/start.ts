import logger from "../services/log";
import { captureError } from "../observability/posthog";
import { processOngoingSequences } from "./process-ongoing-sequences";
import { processRules } from "./process-rules";

export function startAutomation() {
    processOngoingSequences().catch((err) => {
        logger.error({ error: err.message }, "processOngoingSequences crashed");
        captureError({
            error: err,
            source: "automation.process_ongoing_sequences.crash",
            severity: "critical",
        });
    });
    processRules().catch((err) => {
        logger.error({ error: err.message }, "processRules crashed");
        captureError({
            error: err,
            source: "automation.process_rules.crash",
            severity: "critical",
        });
    });
}
