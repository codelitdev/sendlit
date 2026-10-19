import { beforeAll, describe, expect, it, type Mock, mock } from "bun:test";
import type { Job } from "bullmq";

const mocks = {
  processReceipt: mock(),
  on: mock(),
};

mock.module("./process-receipt", () => ({
  processWebhookReceipt: mocks.processReceipt,
}));
mock.module("bullmq", () => ({
  // Bun binds `this` to the mock itself under `new`, so return the instance.
  Worker: mock(
    (name: string, processor: (job: Job) => Promise<void>, options: unknown) => ({
      name,
      processor,
      options,
      on: mocks.on,
    }),
  ),
}));
mock.module("../mail/worker-options", () => ({
  workerOptions: { connection: { host: "redis" }, lockDuration: 300_000 },
  registerWorkerEvents: mock(),
}));

const { Worker } = await import("bullmq");
await import("./feedback-worker");

const WorkerMock = Worker as unknown as Mock<(...args: unknown[]) => void>;

let processor: (job: Job) => Promise<void>;

beforeAll(() => {
  processor = WorkerMock.mock.calls[0][1] as typeof processor;
});

describe("feedback BullMQ worker", () => {
  it("uses the feedback queue with bounded concurrency", () => {
    expect(WorkerMock).toHaveBeenCalledWith(
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
