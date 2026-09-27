import logger from "../services/log";
import { captureEvent } from "../observability/posthog";

/** Structured billing telemetry. Never include checkout URLs, portal URLs,
 * secrets, or raw provider payloads. */
export function recordBillingMetric(
    event: string,
    properties: Record<string, unknown> = {},
): void {
    logger.info({ billing_metric: event, ...properties }, event);
    captureEvent({
        event,
        source: "billing",
        properties,
    });
}
