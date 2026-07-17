import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const workerOnMock = vi.hoisted(() => vi.fn());
const outboundMocks = vi.hoisted(() => ({ markAccepted: vi.fn() }));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

vi.mock("./send", () => ({
    sendMail: vi.fn(),
}));

vi.mock("../delivery-feedback/outbound-queries", async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import("../delivery-feedback/outbound-queries")
        >();
    return { ...actual, markOutboundAccepted: outboundMocks.markAccepted };
});

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
import { addOrStrengthenSuppression } from "../delivery-feedback/suppression-queries";
import { createCustomRouteOutboundMessage } from "../delivery-feedback/outbound-send";
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
    const [outbox] = await tdb
        .select({ id: schema.espConfigs.id })
        .from(schema.espConfigs)
        .where(eq(schema.espConfigs.teamId, teamId));
    const [row] = await tdb
        .insert(schema.transactionalEmails)
        .values({
            teamId,
            toEmail: "buyer@example.com",
            fromEmail: "sender@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            status: "queued",
            outboxId: outbox?.id,
            ...overrides,
        })
        .returning();
    return row;
}

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
    outboundMocks.markAccepted.mockResolvedValue(undefined);
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

    it("marks the row sent without incrementing platform quota", async () => {
        const { team, account } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        sendMailMock.mockResolvedValueOnce({
            messageId: null,
            providerResponse: null,
        });

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
        expect(after?.dailyMailCount).toBe(before?.dailyMailCount);
        expect(after?.monthlyMailCount).toBe(before?.monthlyMailCount);
    });

    it("atomically claims a queued email so concurrent workers send only once", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        let releaseSend!: () => void;
        sendMailMock.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseSend = () =>
                        resolve({ messageId: null, providerResponse: null });
                }),
        );
        const job = makeJob({ data: { transactionalEmailId: row.id } });

        const first = processor(job);
        await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledOnce());
        await processor(job);

        expect(sendMailMock).toHaveBeenCalledOnce();
        releaseSend();
        await first;
        expect((await getTransactionalEmailById(row.id))?.status).toBe("sent");
    });

    it("releases a transient claim so the BullMQ retry can send", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        sendMailMock
            .mockRejectedValueOnce(new Error("connection reset"))
            .mockResolvedValueOnce({ messageId: null, providerResponse: null });
        const firstAttempt = makeJob({
            data: { transactionalEmailId: row.id },
            attemptsMade: 0,
            opts: { attempts: 3 },
        });

        await expect(processor(firstAttempt)).rejects.toThrow(
            "connection reset",
        );
        await expect(
            processor({ ...firstAttempt, attemptsMade: 1 } as Job),
        ).resolves.toBeUndefined();

        expect(sendMailMock).toHaveBeenCalledTimes(2);
        expect((await getTransactionalEmailById(row.id))?.status).toBe("sent");
    });

    it("recovers an expired processing claim but leaves a live claim alone", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id, {
            processingStartedAt: new Date(),
        });
        sendMailMock.mockResolvedValue({
            messageId: null,
            providerResponse: null,
        });
        const job = makeJob({ data: { transactionalEmailId: row.id } });

        await processor(job);
        expect(sendMailMock).not.toHaveBeenCalled();

        await tdb
            .update(schema.transactionalEmails)
            .set({ processingStartedAt: new Date(Date.now() - 11 * 60_000) })
            .where(eq(schema.transactionalEmails.id, row.id));
        await processor(job);

        expect(sendMailMock).toHaveBeenCalledOnce();
        expect((await getTransactionalEmailById(row.id))?.status).toBe("sent");
    });

    it("does not resend after SMTP and status persistence succeed but ledger projection fails", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id);
        const [esp] = await tdb
            .select()
            .from(schema.espConfigs)
            .where(eq(schema.espConfigs.teamId, team.id));
        await createCustomRouteOutboundMessage({
            teamId: team.id,
            espConfigId: esp.id,
            provider: esp.provider,
            sourceType: "transactional",
            submissionKey: `transactional:${row.id}`,
            transactionalEmailId: row.id,
            recipientEmail: row.toEmail,
            normalizedRecipient: row.toEmail,
        });
        sendMailMock.mockResolvedValue({
            messageId: "provider-message",
            providerResponse: "provider-message",
        });
        outboundMocks.markAccepted.mockRejectedValueOnce(
            new Error("ledger projection unavailable"),
        );
        const job = makeJob({ data: { transactionalEmailId: row.id } });

        await expect(processor(job)).rejects.toThrow(
            "ledger projection unavailable",
        );
        expect((await getTransactionalEmailById(row.id))?.status).toBe("sent");

        await expect(processor(job)).resolves.toBeUndefined();
        expect(sendMailMock).toHaveBeenCalledOnce();
    });

    it("is a no-op when the row doesn't exist", async () => {
        const job = makeJob({
            data: { transactionalEmailId: crypto.randomUUID() },
        });

        await expect(processor(job)).resolves.toBeUndefined();
        expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("fails a queued email whose pinned user ESP is missing", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id, { outboxId: null });

        await expect(
            processor(makeJob({ data: { transactionalEmailId: row.id } })),
        ).resolves.toBeUndefined();

        const updated = await getTransactionalEmailById(row.id);
        expect(updated).toMatchObject({
            status: "failed",
            error: "Team ESP is not configured.",
        });
        expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("exits idempotently as suppressed when the recipient was suppressed after enqueue", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await seedQueuedEmail(team.id, {
            toEmail: "late-bounce@example.com",
        });
        await addOrStrengthenSuppression({
            teamId: team.id,
            recipientEmail: "late-bounce@example.com",
            reason: "complaint",
            actorType: "system",
        });

        await expect(
            processor(makeJob({ data: { transactionalEmailId: row.id } })),
        ).resolves.toBeUndefined();

        const updated = await getTransactionalEmailById(row.id);
        expect(updated?.status).toBe("suppressed");
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
