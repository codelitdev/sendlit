import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getDue: vi.fn(),
    recoverStale: vi.fn(),
    processReceipt: vi.fn(),
    captureError: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
}));

vi.mock("./webhook-receipt-queries", () => ({
    getReceiptsDueForProcessing: mocks.getDue,
    recoverStaleProcessingReceipts: mocks.recoverStale,
}));
vi.mock("./process-receipt", () => ({
    processWebhookReceipt: mocks.processReceipt,
}));
vi.mock("../observability/posthog", () => ({
    captureError: mocks.captureError,
}));
vi.mock("../services/log", () => ({
    default: { info: mocks.info, error: mocks.error },
}));

import { pollFeedbackReceiptsOnce } from "./poller";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverStale.mockResolvedValue(0);
    mocks.getDue.mockResolvedValue([]);
    mocks.processReceipt.mockResolvedValue(undefined);
});

describe("feedback receipt recovery pass", () => {
    it("recovers stale claims before loading due receipts", async () => {
        const order: string[] = [];
        mocks.recoverStale.mockImplementation(async () => {
            order.push("recover");
            return 2;
        });
        mocks.getDue.mockImplementation(async () => {
            order.push("load");
            return [];
        });

        await pollFeedbackReceiptsOnce();

        expect(order).toEqual(["recover", "load"]);
        expect(mocks.info).toHaveBeenCalledWith(
            { count: 2 },
            "recovered stale processing webhook receipts",
        );
    });

    it("processes every due receipt", async () => {
        mocks.getDue.mockResolvedValue([
            { id: "internal-1", receiptId: "receipt_1" },
            { id: "internal-2", receiptId: "receipt_2" },
        ]);

        await pollFeedbackReceiptsOnce();

        expect(mocks.processReceipt.mock.calls).toEqual([
            ["internal-1"],
            ["internal-2"],
        ]);
    });

    it("isolates a poison receipt and continues the pass", async () => {
        mocks.getDue.mockResolvedValue([
            { id: "internal-1", receiptId: "receipt_1" },
            { id: "internal-2", receiptId: "receipt_2" },
        ]);
        mocks.processReceipt
            .mockRejectedValueOnce(new Error("invalid provider payload"))
            .mockResolvedValueOnce(undefined);

        await pollFeedbackReceiptsOnce();

        expect(mocks.processReceipt).toHaveBeenCalledTimes(2);
        expect(mocks.captureError).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "feedback.poller.process_receipt",
                context: { receipt_id: "receipt_1" },
            }),
        );
    });

    it("surfaces recovery failures to the outer loop", async () => {
        mocks.recoverStale.mockRejectedValue(new Error("database unavailable"));

        await expect(pollFeedbackReceiptsOnce()).rejects.toThrow(
            "database unavailable",
        );
        expect(mocks.getDue).not.toHaveBeenCalled();
    });
});
