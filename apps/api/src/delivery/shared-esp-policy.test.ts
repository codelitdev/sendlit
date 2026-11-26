import { describe, expect, it } from "bun:test";
import { advanceControlState } from "../billing/reputation-policy";
import { type SharedEspGuardConfig, sharedEspDecision } from "./shared-esp-policy";

const config: SharedEspGuardConfig = {
  enabled: true,
  minimumAccepted: 200,
  bounceWarnBps: 200,
  complaintWarnBps: 5,
  bouncePauseBps: 400,
  complaintPauseBps: 8,
  teamMinimumBounces: 5,
  teamMinimumComplaints: 2,
  minimumHoldHours: 72,
  recoveryCleanDays: 3,
};

const team = (teamId: string, accepted: number, bounced = 0, complained = 0) => ({
  teamId,
  accepted,
  bounced,
  complained,
});

describe("shared ESP guard decisions", () => {
  it("leaves a clean ESP alone", () => {
    const decision = sharedEspDecision(
      [team("a", 1000, 5), team("b", 1000, 3, 0)],
      config,
    );
    expect(decision.esp.status).toBe("normal");
    expect(decision.pausedTeams).toEqual([]);
  });

  it("pauses only the team with the bad list", () => {
    const decision = sharedEspDecision(
      [team("bad", 100, 20), team("b", 1000, 2), team("c", 1000, 1)],
      config,
    );
    expect(decision.pausedTeams).toEqual([
      { teamId: "bad", reason: "shared_esp_team_breach" },
    ]);
    expect(decision.esp.status).toBe("normal");
  });

  it("judges a small team on counts, not the 500-send floor", () => {
    const decision = sharedEspDecision(
      [team("tiny", 40, 6), team("big", 5000, 10)],
      config,
    );
    expect(decision.pausedTeams.map((t) => t.teamId)).toEqual(["tiny"]);
  });

  it("never pauses a team for a single complaint", () => {
    const decision = sharedEspDecision([team("a", 300, 0, 1), team("b", 300)], config);
    expect(decision.pausedTeams).toEqual([]);
  });

  it("pauses warning-level contributors worst first until the rest is under the warning rate", () => {
    // Each team is under the 4% pause rate, but together they're over 2%.
    const decision = sharedEspDecision(
      [team("worst", 300, 11), team("mid", 300, 9), team("clean", 400, 2)],
      config,
    );
    expect(decision.pausedTeams).toEqual([
      { teamId: "worst", reason: "shared_esp_top_contributor" },
    ]);
    expect(decision.esp.status).toBe("warned");
  });

  it("never pauses a clean team to fix the ratio", () => {
    const decision = sharedEspDecision(
      [team("clean", 1000, 1), team("noisy", 100, 3)],
      config,
    );
    expect(decision.pausedTeams).toEqual([]);
  });

  it("pauses the whole ESP when the problem is spread over many small teams", () => {
    const teams = Array.from({ length: 30 }, (_, i) => team(`t${i}`, 10, 1));
    const decision = sharedEspDecision(teams, config);
    expect(decision.pausedTeams).toEqual([]);
    expect(decision.esp).toEqual({
      status: "marketing_paused",
      reason: "shared_esp_breach",
    });
  });

  it("warns when the combined rate is high but the culprits are paused", () => {
    const decision = sharedEspDecision(
      [team("bad", 300, 30), team("b", 300, 2)],
      config,
    );
    expect(decision.pausedTeams.map((t) => t.teamId)).toEqual(["bad"]);
    expect(decision.esp.status).toBe("warned");
  });

  it("does not judge combined rates on a tiny sample", () => {
    const decision = sharedEspDecision([team("a", 50, 4)], config);
    expect(decision.esp.status).toBe("normal");
  });
});

describe("sending control transitions", () => {
  const options = {
    minimumHoldHours: 72,
    recoveryCleanDays: 3,
    recoveredReason: "recovered",
    heldReason: "held",
  };
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 12));

  it("pauses immediately and starts the hold", () => {
    const next = advanceControlState(
      {
        status: "normal",
        reasonCode: null,
        evaluatedAt: null,
        cleanEvaluationDays: 0,
        minimumHoldUntil: null,
      },
      { status: "marketing_paused", reason: "breach" },
      day(0),
      options,
    );
    expect(next.status).toBe("marketing_paused");
    expect(next.minimumHoldUntil?.getTime()).toBe(day(3).getTime());
  });

  it("recovers only after the hold and enough clean days, one per UTC day", () => {
    let state = {
      status: "marketing_paused" as const,
      reasonCode: "breach",
      evaluatedAt: day(0) as Date | null,
      cleanEvaluationDays: 0,
      minimumHoldUntil: day(3) as Date | null,
    };
    const clean = { status: "normal" as const, reason: "clean" };
    const sameDay = advanceControlState(state, clean, day(0), options);
    expect(sameDay.cleanEvaluationDays).toBe(0);
    let current: ReturnType<typeof advanceControlState> | null = null;
    for (const n of [1, 2, 3]) {
      current = advanceControlState(state, clean, day(n), options);
      state = {
        ...state,
        status: current.status as "marketing_paused",
        evaluatedAt: day(n),
        cleanEvaluationDays: current.cleanEvaluationDays,
        minimumHoldUntil: current.minimumHoldUntil,
      };
    }
    expect(current?.status).toBe("normal");
    expect(current?.reason).toBe("recovered");
  });

  it("keeps an all-pause until an operator lifts it", () => {
    const next = advanceControlState(
      {
        status: "all_paused",
        reasonCode: "complaint_stop",
        evaluatedAt: day(0),
        cleanEvaluationDays: 9,
        minimumHoldUntil: null,
      },
      { status: "normal", reason: "clean" },
      day(5),
      options,
    );
    expect(next.status).toBe("all_paused");
  });
});
