import { describe, expect, it } from "vitest";
import type { ReputationConfig } from "./reputation-config";
import { reputationDecision } from "./reputation-policy";

const config: ReputationConfig = {
    minimumAccepted: 500,
    bounceWarnBps: 200,
    complaintWarnBps: 5,
    bouncePauseBps: 500,
    complaintPauseBps: 10,
    complaintStopBps: 30,
    complaintStopAbsolute: 10,
    transactionalDailyLimit: 100,
    minimumHoldHours: 72,
    recoveryCleanDays: 7,
};

describe("fair-use reputation decisions", () => {
    it("does not percentage-pause statistically small samples", () => {
        expect(
            reputationDecision(
                { accepted: 20, bounced: 3, complained: 0 },
                config,
                false,
            ),
        ).toEqual({ status: "normal", reason: "reputation_clean" });
    });

    it("stops an absolute complaint burst even below the rate sample floor", () => {
        expect(
            reputationDecision(
                { accepted: 20, bounced: 0, complained: 10 },
                config,
                false,
            ),
        ).toEqual({ status: "all_paused", reason: "complaint_stop" });
    });

    it("applies percentage thresholds once enough mail was accepted", () => {
        expect(
            reputationDecision(
                { accepted: 500, bounced: 25, complained: 0 },
                config,
                true,
            ),
        ).toEqual({ status: "marketing_paused", reason: "reputation_pause" });
    });
});
