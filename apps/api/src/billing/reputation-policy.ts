import type { ReputationConfig } from "./reputation-config";

export type ReputationMetrics = {
    accepted: number;
    bounced: number;
    complained: number;
};

export type ReputationDecision = {
    status: "normal" | "warned" | "marketing_paused" | "all_paused";
    reason: string;
};

function rateAtLeast(
    numerator: number,
    denominator: number,
    thresholdBps: number,
): boolean {
    return denominator > 0 && numerator * 10_000 >= denominator * thresholdBps;
}

export function reputationDecision(
    metrics: ReputationMetrics,
    config: ReputationConfig,
    evaluateRates: boolean,
): ReputationDecision {
    if (metrics.complained >= config.complaintStopAbsolute) {
        return { status: "all_paused", reason: "complaint_stop" };
    }
    if (!evaluateRates) {
        return { status: "normal", reason: "reputation_clean" };
    }
    if (
        rateAtLeast(
            metrics.complained,
            metrics.accepted,
            config.complaintStopBps,
        )
    ) {
        return { status: "all_paused", reason: "complaint_stop" };
    }
    if (
        rateAtLeast(metrics.bounced, metrics.accepted, config.bouncePauseBps) ||
        rateAtLeast(
            metrics.complained,
            metrics.accepted,
            config.complaintPauseBps,
        )
    ) {
        return { status: "marketing_paused", reason: "reputation_pause" };
    }
    if (
        rateAtLeast(metrics.bounced, metrics.accepted, config.bounceWarnBps) ||
        rateAtLeast(
            metrics.complained,
            metrics.accepted,
            config.complaintWarnBps,
        )
    ) {
        return { status: "warned", reason: "reputation_warning" };
    }
    return { status: "normal", reason: "reputation_clean" };
}
