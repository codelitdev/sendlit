import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

const mocks = vi.hoisted(() => ({
    processReceipt: vi.fn(),
    on: vi.fn(),
}));

vi.mock("./process-receipt", () => ({
    processWebhookReceipt: mocks.processReceipt,
}));
vi.mock("bullmq", () => ({
    Worker: vi.fn().mockImplementation(function (
        this: any,
        name: string,
        processor: (job: Job) => Promise<void>,
        options: unknown,
    ) {
        this.name = name;
        this.processor = processor;
        this.options = options;
        this.on = mocks.on;
    }),
}));
vi.mock("../mail/worker-options", () => ({
    workerOptions: { connection: { host: "redis" }, lockDuration: 300_000 },
    registerWorkerEvents: vi.fn(),
}));

import { Worker } from "bullmq";
import "./feedback-worker";

let processor: (job: Job) => Promise<void>;

beforeAll(() => {
    processor = vi.mocked(Worker).mock.calls[0][1] as typeof processor;
});

describe("feedback BullMQ worker", () => {
    it("uses the feedback queue with bounded concurrency", () => {
        expect(vi.mocked(Worker)).toHaveBeenCalledWith(
            "esp-feedback",
            expect.any(Function),
            expect.objectContaining({ concurrency: 5, lockDuration: 300_000 }),
        );
    });

    it("passes the durable receipt id to the processor", async () => {
        mocks.processReceipt.mockResolvedValue(undefined);

        await processor({ data: { receiptId: "receipt-internal" } } as Job);

        expect(mocks.processReceipt).toHaveBeenCalledWith("receipt-internal");
    });

    it("rethrows processing failures so BullMQ retry policy applies", async () => {
        mocks.processReceipt.mockRejectedValue(new Error("temporary failure"));

        await expect(
            processor({ data: { receiptId: "receipt-internal" } } as Job),
        ).rejects.toThrow("temporary failure");
    });
});
