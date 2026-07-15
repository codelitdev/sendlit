import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const workerOnMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

vi.mock("./send", () => ({
    sendMail: vi.fn(),
}));

// The real `Worker` constructor would try to open a connection to Redis
// (unavailable in tests). Mocking it lets us capture the processor function
// passed as its second argument and invoke it directly against fake jobs,
// while keeping the real `UnrecoverableError` export so `instanceof` checks
// in the processor (and in this test) still work.
vi.mock("bullmq", async (importOriginal) => {
    const actual = await importOriginal<typeof import("bullmq")>();
    return {
        ...actual,
        Worker: vi.fn().mockImplementation(function (
            this: any,
            name: string,
            processor: any,
        ) {
            this.name = name;
            this.processor = processor;
            this.on = workerOnMock;
        }),
    };
});

import { Worker, UnrecoverableError, type Job } from "bullmq";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { sendMail } from "./send";
import { getAccount } from "../account/queries";
import { getTransactionalEmailById } from "../transactional/queries";
import "./worker";

const tdb = db as unknown as TestDb;
const sendMailMock = vi.mocked(sendMail);
const WorkerMock = vi.mocked(Worker);

// Importing "./worker" above runs its top-level `new Worker(...)` call
// exactly once (module singleton) — the mocked constructor captures the
// processor as its second argument. Captured in `beforeAll`, before any
// `beforeEach` runs `vi.clearAllMocks()`, which would otherwise wipe this
// one-time constructor call's recorded arguments.
let workerConstructorArgs: ConstructorParameters<typeof Worker> | undefined;
let processor: (job: Job) => Promise<any>;
let registeredWorkerEvents: string[];

beforeAll(() => {
    workerConstructorArgs = WorkerMock.mock.calls[0];
    processor = workerConstructorArgs?.[1] as (job: Job) => Promise<any>;
    registeredWorkerEvents = workerOnMock.mock.calls.map(([event]) =>
        String(event),
    );
});

function makeJob(overrides: Partial<Job> & { data: any }): Job {
    return {
        id: "job-1",
        name: "transactional",
        attemptsMade: 0,
        opts: { attempts: 3 },
        ...overrides,
    } as unknown as Job;
}

async function seedQueuedEmail(
    teamId: string,
    overrides: Partial<typeof schema.transactionalEmails.$inferInsert> = {},
) {
    const [row] = await tdb
        .insert(schema.transactionalEmails)
        .values({
            teamId,
            toEmail: "buyer@example.com",
            fromEmail: "sender@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            status: "queued",
            ...overrides,
        })
        .returning();
    return row;
}

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

describe("mail worker — transactional job processing", () => {
    it("constructs the BullMQ Worker for the 'mail' queue", () => {
        expect(workerConstructorArgs?.[0]).toBe("mail");
        expect(workerConstructorArgs?.[2]).toEqual(
            expect.objectContaining({
                connection: expect.anything(),
                lockDuration: 5 * 60 * 1000,
                stalledInterval: 30 * 1000,
                maxStalledCount: 2,
            }),
        );
        expect(registeredWorkerEvents).toEqual(["failed", "stalled", "error"]);
        expect(processor).toBeInstanceOf(Function);
    });

    it("rethrows a transient send error and leaves the row queued on a non-final attempt", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        sendMailMock.mockRejectedValueOnce(new Error("connection reset"));

        const job = makeJob({
            data: { transactionalEmailId: row.id },
            attemptsMade: 0,
            opts: { attempts: 3 },
        });

        await expect(processor(job)).rejects.toThrow("connection reset");

        const updated = await getTransactionalEmailById(row.id);
        expect(updated?.status).toBe("queued");
        expect(updated?.error).toBeNull();
    });

    it("rethrows a transient send error and marks the row failed on the final attempt", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        sendMailMock.mockRejectedValueOnce(new Error("connection reset"));

        const job = makeJob({
            data: { transactionalEmailId: row.id },
            attemptsMade: 2,
            opts: { attempts: 3 },
        });

        await expect(processor(job)).rejects.toThrow("connection reset");

        const updated = await getTransactionalEmailById(row.id);
        expect(updated?.status).toBe("failed");
        expect(updated?.error).toBe("connection reset");
    });

    it("throws UnrecoverableError and marks the row bounced on a permanent SMTP rejection", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        const smtpError = Object.assign(new Error("mailbox unavailable"), {
            responseCode: 550,
        });
        sendMailMock.mockRejectedValueOnce(smtpError);

        const job = makeJob({
            data: { transactionalEmailId: row.id },
            attemptsMade: 0,
            opts: { attempts: 3 },
        });

        let thrown: unknown;
        try {
            await processor(job);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(UnrecoverableError);

        const updated = await getTransactionalEmailById(row.id);
        expect(updated?.status).toBe("bounced");
        expect(updated?.error).toBe("mailbox unavailable");
    });

    it("marks the row sent and increments the owning account's mail count on success", async () => {
        const { team, account } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        sendMailMock.mockResolvedValueOnce(undefined);

        const before = await getAccount(account.id);

        const job = makeJob({
            data: { transactionalEmailId: row.id },
            attemptsMade: 0,
            opts: { attempts: 3 },
        });

        await expect(processor(job)).resolves.toBeUndefined();

        const updated = await getTransactionalEmailById(row.id);
        expect(updated?.status).toBe("sent");
        expect(updated?.sentAt).toBeInstanceOf(Date);

        const after = await getAccount(account.id);
        expect(after?.dailyMailCount).toBe((before?.dailyMailCount ?? 0) + 1);
        expect(after?.monthlyMailCount).toBe(
            (before?.monthlyMailCount ?? 0) + 1,
        );
    });

    it("is a no-op when the row doesn't exist", async () => {
        const job = makeJob({
            data: { transactionalEmailId: crypto.randomUUID() },
        });

        await expect(processor(job)).resolves.toBeUndefined();
        expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("is a no-op when the row is no longer queued (already sent)", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id, {
            status: "sent",
            sentAt: new Date(),
        });

        const job = makeJob({ data: { transactionalEmailId: row.id } });

        await expect(processor(job)).resolves.toBeUndefined();
        expect(sendMailMock).not.toHaveBeenCalled();
    });
});
