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
  if (rateAtLeast(metrics.complained, metrics.accepted, config.complaintStopBps)) {
    return { status: "all_paused", reason: "complaint_stop" };
  }
  if (
    rateAtLeast(metrics.bounced, metrics.accepted, config.bouncePauseBps) ||
    rateAtLeast(metrics.complained, metrics.accepted, config.complaintPauseBps)
  ) {
    return { status: "marketing_paused", reason: "reputation_pause" };
  }
  if (
    rateAtLeast(metrics.bounced, metrics.accepted, config.bounceWarnBps) ||
    rateAtLeast(metrics.complained, metrics.accepted, config.complaintWarnBps)
  ) {
    return { status: "warned", reason: "reputation_warning" };
  }
  return { status: "normal", reason: "reputation_clean" };
}

export type ControlStatus = ReputationDecision["status"];

export type ControlState = {
  status: ControlStatus;
  reasonCode: string | null;
  evaluatedAt: Date | null;
  cleanEvaluationDays: number;
  minimumHoldUntil: Date | null;
};

export type ControlTransition = {
  status: ControlStatus;
  reason: string;
  cleanEvaluationDays: number;
  minimumHoldUntil: Date | null;
  alreadyEvaluatedToday: boolean;
};

const CONTROL_RANK: Record<ControlStatus, number> = {
  normal: 0,
  warned: 1,
  marketing_paused: 2,
  all_paused: 3,
};

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The next state of a sending control given what its latest metrics ask for.
 * Escalation is immediate (a marketing pause starts its minimum hold);
 * recovery never skips the hold and needs `recoveryCleanDays` clean
 * evaluations, counted at most once per UTC day. Any breach resets the
 * streak, and a weaker breach cannot drop a pause to warned. The caller
 * handles sticky states (an all-pause waits for an operator).
 */
export function advanceControlState(
  control: ControlState,
  desired: { status: ControlStatus; reason: string },
  now: Date,
  config: {
    minimumHoldHours: number;
    recoveryCleanDays: number;
    recoveredReason: string;
    heldReason: string;
  },
): ControlTransition {
  const alreadyEvaluatedToday = Boolean(
    control.evaluatedAt && utcDay(control.evaluatedAt) === utcDay(now),
  );
  let status = desired.status;
  let cleanEvaluationDays = control.cleanEvaluationDays;
  let reason = desired.reason;
  let minimumHoldUntil = control.minimumHoldUntil;
  if (CONTROL_RANK[desired.status] > CONTROL_RANK[control.status]) {
    cleanEvaluationDays = 0;
    if (desired.status === "marketing_paused") {
      minimumHoldUntil = new Date(
        now.getTime() + config.minimumHoldHours * 60 * 60 * 1000,
      );
    }
  } else if (CONTROL_RANK[desired.status] < CONTROL_RANK[control.status]) {
    if (control.status === "marketing_paused" || control.status === "warned") {
      if (desired.status === "normal" && !alreadyEvaluatedToday) {
        cleanEvaluationDays += 1;
      } else if (desired.status !== "normal") {
        cleanEvaluationDays = 0;
      }
      const holdElapsed =
        !minimumHoldUntil || minimumHoldUntil.getTime() <= now.getTime();
      if (cleanEvaluationDays >= config.recoveryCleanDays && holdElapsed) {
        status = "normal";
        reason = config.recoveredReason;
        minimumHoldUntil = null;
      } else {
        status = control.status;
        reason = control.reasonCode ?? config.heldReason;
      }
    } else {
      // all_paused only lifts through an operator.
      status = control.status;
      reason = control.reasonCode ?? config.heldReason;
    }
  } else if (desired.status === "warned" || desired.status === "marketing_paused") {
    cleanEvaluationDays = 0;
  }
  return {
    status,
    reason,
    cleanEvaluationDays,
    minimumHoldUntil,
    alreadyEvaluatedToday,
  };
}
