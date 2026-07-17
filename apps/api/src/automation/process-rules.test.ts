import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    deleteRule: vi.fn(),
    enrollContacts: vi.fn(),
    getDueRules: vi.fn(),
    getInternalIds: vi.fn(),
    getPublicIds: vi.fn(),
    getSequence: vi.fn(),
    lockBroadcast: vi.fn(),
    captureError: vi.fn(),
    captureEvent: vi.fn(),
}));

vi.mock("./queries", () => ({
    deleteRule: mocks.deleteRule,
    enrollContactsInOngoingSequence: mocks.enrollContacts,
    getDueDateRules: mocks.getDueRules,
    getMatchingContactIds: mocks.getInternalIds,
    getMatchingPublicContactIds: mocks.getPublicIds,
    getSequenceRowById: mocks.getSequence,
    lockBroadcast: mocks.lockBroadcast,
}));
vi.mock("../observability/posthog", () => ({
    captureError: mocks.captureError,
    captureEvent: mocks.captureEvent,
}));
vi.mock("../services/log", () => ({
    default: { error: vi.fn(), info: vi.fn() },
}));

import { processDueRulesOnce, processRule } from "./process-rules";

const rule = {
    ruleId: "rule_1",
    teamId: "team-1",
    sequenceId: "sequence-internal",
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteRule.mockResolvedValue(undefined);
    mocks.enrollContacts.mockResolvedValue(undefined);
    mocks.getInternalIds.mockResolvedValue(["contact-internal"]);
    mocks.getPublicIds.mockResolvedValue(["cnt_public"]);
    mocks.lockBroadcast.mockResolvedValue(undefined);
    mocks.getSequence.mockResolvedValue({
        id: "sequence-internal",
        sequenceId: "seq_public",
        filter: { aggregator: "and", filters: [] },
    });
});

describe("scheduled broadcast rule processing", () => {
    it("removes an orphaned rule without attempting enrollment", async () => {
        mocks.getSequence.mockResolvedValue(null);

        await processRule(rule);

        expect(mocks.deleteRule).toHaveBeenCalledWith("rule_1");
        expect(mocks.enrollContacts).not.toHaveBeenCalled();
        expect(mocks.lockBroadcast).not.toHaveBeenCalled();
    });

    it("enrolls the internal audience, snapshots public ids, locks, then deletes", async () => {
        const order: string[] = [];
        mocks.enrollContacts.mockImplementation(async () => {
            order.push("enroll");
        });
        mocks.lockBroadcast.mockImplementation(async () => {
            order.push("lock");
        });
        mocks.deleteRule.mockImplementation(async () => {
            order.push("delete");
        });

        await processRule(rule);

        expect(mocks.enrollContacts).toHaveBeenCalledWith({
            teamId: "team-1",
            sequenceId: "sequence-internal",
            contactIds: ["contact-internal"],
        });
        expect(mocks.lockBroadcast).toHaveBeenCalledWith("sequence-internal", [
            "cnt_public",
        ]);
        expect(order).toEqual(["enroll", "lock", "delete"]);
    });

    it("handles an empty audience and still consumes the due rule", async () => {
        mocks.getInternalIds.mockResolvedValue([]);
        mocks.getPublicIds.mockResolvedValue([]);

        await processRule(rule);

        expect(mocks.enrollContacts).toHaveBeenCalledWith(
            expect.objectContaining({ contactIds: [] }),
        );
        expect(mocks.lockBroadcast).toHaveBeenCalledWith(
            "sequence-internal",
            [],
        );
        expect(mocks.deleteRule).toHaveBeenCalledWith("rule_1");
    });

    it("isolates a failed rule and continues processing later rules", async () => {
        const secondRule = { ...rule, ruleId: "rule_2", sequenceId: "seq-2" };
        mocks.getDueRules.mockResolvedValue([rule, secondRule]);
        mocks.enrollContacts
            .mockRejectedValueOnce(new Error("temporary database failure"))
            .mockResolvedValueOnce(undefined);

        await processDueRulesOnce();

        expect(mocks.captureError).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "automation.process_rules.rule",
                teamId: "team-1",
            }),
        );
        expect(mocks.enrollContacts).toHaveBeenCalledTimes(2);
        expect(mocks.deleteRule).toHaveBeenCalledTimes(1);
    });

    it("does not delete a rule when locking its audience snapshot fails", async () => {
        mocks.lockBroadcast.mockRejectedValue(new Error("lock failed"));

        await expect(processRule(rule)).rejects.toThrow("lock failed");

        expect(mocks.deleteRule).not.toHaveBeenCalled();
    });
});
