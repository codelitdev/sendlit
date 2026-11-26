import { positiveInt } from "../billing/reputation-config";
import {
  type ReputationMetrics as Counts,
  rateAtLeast,
} from "../billing/reputation-policy";

/**
 * Shared-ESP guard thresholds (#220, ADR 0013). They sit below the
 * account-level limits ESPs enforce (Amazon SES reviews an account at about
 * 5% bounces or 0.1% complaints), so SendLit acts before the ESP does.
 */
export type SharedEspGuardConfig = {
  enabled: boolean;
  /** Accepted sends across the ESP before its combined rates are judged. */
  minimumAccepted: number;
  bounceWarnBps: number;
  complaintWarnBps: number;
  bouncePauseBps: number;
  complaintPauseBps: number;
  /** A team is judged on rates once it has this many bounces... */
  teamMinimumBounces: number;
  /** ...or this many complaints, however few emails it sent. */
  teamMinimumComplaints: number;
  minimumHoldHours: number;
  recoveryCleanDays: number;
};

/** Throws on an invalid `SHARED_ESP_*` value; the API calls it at startup
 * so a typo fails the boot instead of a send. */
export function readSharedEspGuardConfig(): SharedEspGuardConfig {
  const raw = process.env.SHARED_ESP_GUARD;
  if (raw !== undefined && raw !== "" && raw !== "on" && raw !== "off") {
    throw new Error("SHARED_ESP_GUARD_invalid");
  }
  const enabled =
    raw === "on" ||
    ((raw === undefined || raw === "") &&
      process.env.SENDLIT_DEPLOYMENT_MODE === "cloud");
  // A bad threshold must never break sending while the guard is off.
  const n = (name: string, fallback: number) =>
    enabled ? positiveInt(name, fallback) : fallback;
  return {
    enabled,
    minimumAccepted: n("SHARED_ESP_MIN_ACCEPTED", 200),
    bounceWarnBps: n("SHARED_ESP_BOUNCE_WARN_BPS", 200),
    complaintWarnBps: n("SHARED_ESP_COMPLAINT_WARN_BPS", 5),
    bouncePauseBps: n("SHARED_ESP_BOUNCE_PAUSE_BPS", 400),
    complaintPauseBps: n("SHARED_ESP_COMPLAINT_PAUSE_BPS", 8),
    teamMinimumBounces: n("SHARED_ESP_TEAM_MIN_BOUNCES", 5),
    teamMinimumComplaints: n("SHARED_ESP_TEAM_MIN_COMPLAINTS", 2),
    minimumHoldHours: n("SHARED_ESP_MINIMUM_HOLD_HOURS", 72),
    recoveryCleanDays: n("SHARED_ESP_RECOVERY_CLEAN_DAYS", 3),
  };
}

export type TeamEspMetrics = Counts & { teamId: string };

export type SharedEspTeamReason =
  | "shared_esp_team_breach"
  | "shared_esp_top_contributor";

export type SharedEspDecision = {
  esp: {
    status: "normal" | "warned" | "marketing_paused";
    reason: "shared_esp_clean" | "shared_esp_warning" | "shared_esp_breach";
  };
  /** Teams whose marketing through this ESP should pause, worst first. */
  pausedTeams: { teamId: string; reason: SharedEspTeamReason }[];
  total: Counts;
};

function overRates(counts: Counts, bounceBps: number, complaintBps: number): boolean {
  return (
    rateAtLeast(counts.bounced, counts.accepted, bounceBps) ||
    rateAtLeast(counts.complained, counts.accepted, complaintBps)
  );
}

/** A team's own rates, judged only once it has enough bad events to mean
 * something, so a single complaint never pauses a small team. */
function teamOver(
  team: Counts,
  bounceBps: number,
  complaintBps: number,
  config: SharedEspGuardConfig,
): boolean {
  return (
    (team.bounced >= config.teamMinimumBounces &&
      rateAtLeast(team.bounced, team.accepted, bounceBps)) ||
    (team.complained >= config.teamMinimumComplaints &&
      rateAtLeast(team.complained, team.accepted, complaintBps))
  );
}

function subtract(a: Counts, b: Counts): Counts {
  return {
    accepted: a.accepted - b.accepted,
    bounced: a.bounced - b.bounced,
    complained: a.complained - b.complained,
  };
}

/**
 * Decides what the guard does for one organization ESP from each team's
 * seven-day counts through it:
 *
 * 1. Any team over the pause rates (with enough bad events) pauses.
 * 2. If the rest of the ESP is still over the warning rates, the teams that
 *    are over the warning rates themselves pause too, worst first, until it
 *    isn't. Clean teams never pause to fix the ratio: their sends dilute it.
 * 3. Only if the teams left are still over the pause rates is the problem
 *    broad, and marketing pauses on the whole ESP.
 */
export function sharedEspDecision(
  teams: TeamEspMetrics[],
  config: SharedEspGuardConfig,
): SharedEspDecision {
  const total = teams.reduce<Counts>(
    (sum, team) => ({
      accepted: sum.accepted + team.accepted,
      bounced: sum.bounced + team.bounced,
      complained: sum.complained + team.complained,
    }),
    { accepted: 0, bounced: 0, complained: 0 },
  );
  const score = (team: Counts) =>
    team.bounced / config.bouncePauseBps + team.complained / config.complaintPauseBps;
  const worstFirst = [...teams].sort((a, b) => score(b) - score(a));

  const pausedTeams: SharedEspDecision["pausedTeams"] = [];
  let remaining = total;
  for (const team of worstFirst) {
    if (teamOver(team, config.bouncePauseBps, config.complaintPauseBps, config)) {
      pausedTeams.push({ teamId: team.teamId, reason: "shared_esp_team_breach" });
      remaining = subtract(remaining, team);
    }
  }
  for (const team of worstFirst) {
    if (
      remaining.accepted < config.minimumAccepted ||
      !overRates(remaining, config.bounceWarnBps, config.complaintWarnBps)
    ) {
      break;
    }
    if (pausedTeams.some((paused) => paused.teamId === team.teamId)) continue;
    if (teamOver(team, config.bounceWarnBps, config.complaintWarnBps, config)) {
      pausedTeams.push({ teamId: team.teamId, reason: "shared_esp_top_contributor" });
      remaining = subtract(remaining, team);
    }
  }

  let esp: SharedEspDecision["esp"] = { status: "normal", reason: "shared_esp_clean" };
  if (
    remaining.accepted >= config.minimumAccepted &&
    overRates(remaining, config.bouncePauseBps, config.complaintPauseBps)
  ) {
    esp = { status: "marketing_paused", reason: "shared_esp_breach" };
  } else if (
    total.accepted >= config.minimumAccepted &&
    overRates(total, config.bounceWarnBps, config.complaintWarnBps)
  ) {
    esp = { status: "warned", reason: "shared_esp_warning" };
  }
  return { esp, pausedTeams, total };
}
