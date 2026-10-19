import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
  vi,
} from "bun:test";
import { waitFor } from "@sendlit/test-utils";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import express from "express";

const workerOnMock = mock();

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("./send", () => ({ sendMail: mock() }));
const actualBullmq = await import("bullmq");
mock.module("bullmq", () => ({
  ...actualBullmq,
  // Bun binds `this` to the mock itself under `new`, so return the instance.
  Worker: mock((name: string, processor: any) => ({
    name,
    processor,
    on: workerOnMock,
  })),
}));

const { UnrecoverableError, Worker } = await import("bullmq");
const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { isRecipientSuppressed } = await import(
  "../delivery-feedback/suppression-queries"
);
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { default: trackingRoutes } = await import("../tracking/routes");
const { getTransactionalEmailById } = await import("../transactional/queries");
const { sendMail } = await import("./send");
await import("./worker");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;
const sendMailMock = sendMail as unknown as Mock<typeof sendMail>;
const WorkerMock = Worker as unknown as Mock<(...args: unknown[]) => void>;

let processor: (job: Job) => Promise<void>;
let workerQueueName: string | undefined;
let registeredEvents: string[];

beforeAll(() => {
  const args = WorkerMock.mock.calls[0];
  workerQueueName = args?.[0] as string | undefined;
  processor = args?.[1] as (job: Job) => Promise<void>;
  registeredEvents = workerOnMock.mock.calls.map(([event]) => String(event));
});

beforeEach(async () => {
  await truncateAll(tdb);
  vi.clearAllMocks();
});

function job(transactionalEmailId: string, attemptsMade = 0): Job {
  return {
    id: "job-1",
    name: "transactional",
    data: { transactionalEmailId },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job;
}

async function queuedEmail(
  teamId: string,
  options: {
    outboxId?: string | null;
    html?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
  } = {},
) {
  const [esp] = await tdb
    .select()
    .from(schema.espConfigs)
    .where(eq(schema.espConfigs.teamId, teamId));
  const [row] = await tdb
    .insert(schema.transactionalEmails)
    .values({
      teamId,
      deliverySourceType: "team",
      outboxId: options.outboxId === undefined ? esp.id : options.outboxId,
      toEmail: "buyer@example.com",
      fromEmail: "sender@example.com",
      subject: "Hi",
      html: options.html ?? "<p>hi</p>",
      trackOpens: options.trackOpens ?? false,
      trackClicks: options.trackClicks ?? false,
      status: "queued",
    })
    .returning();
  return row;
}

describe("mail worker transactional processing", () => {
  it("constructs a mail queue worker", () => {
    expect(workerQueueName).toBe("mail");
    expect(processor).toBeInstanceOf(Function);
    expect(registeredEvents).toEqual(["failed", "stalled", "error"]);
  });

  it("sends a pinned team ESP and marks the transactional row sent", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const row = await queuedEmail(team.id);
    sendMailMock.mockResolvedValueOnce({
      messageId: null,
      providerResponse: null,
    });

    await expect(processor(job(row.id))).resolves.toBeUndefined();

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: team.id,
        espConfigId: row.outboxId,
      }),
    );
    await expect(getTransactionalEmailById(row.id)).resolves.toMatchObject({
      status: "sent",
    });
  });

  it("marks an SMTP 5xx as bounced and suppresses the recipient", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const row = await queuedEmail(team.id);
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("mailbox unavailable"), {
        responseCode: 550,
      }),
    );

    await expect(processor(job(row.id))).rejects.toBeInstanceOf(UnrecoverableError);

    await expect(getTransactionalEmailById(row.id)).resolves.toMatchObject({
      status: "bounced",
      error: "mailbox unavailable",
    });
    await expect(isRecipientSuppressed(team.id, row.toEmail)).resolves.toBe(true);
  });

  it("embeds tracking links that resolve against the tracking routes", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const row = await queuedEmail(team.id, {
      html: '<html><body><a href="https://example.com/receipt">Receipt</a></body></html>',
      trackOpens: true,
      trackClicks: true,
    });
    sendMailMock.mockResolvedValueOnce({
      messageId: null,
      providerResponse: null,
    });

    await processor(job(row.id));

    const { html } = sendMailMock.mock.calls[0][0];
    const pixel = new URL(html.match(/src="([^"]+\/track\/open[^"]*)"/)![1]);
    const click = new URL(html.match(/href="([^"]+\/track\/click[^"]*)"/)![1]);
    expect(pixel.origin).toBe("https://sendlit.test");
    expect(pixel.pathname).toBe("/track/open");
    expect(click.pathname).toBe("/track/click");

    const app = express();
    app.use(trackingRoutes);
    const opened = await requestApp(app, pixel.pathname + pixel.search);
    const clicked = await requestApp(app, click.pathname + click.search);

    expect(opened.status).toBe(200);
    expect(clicked.status).toBe(302);
    expect(clicked.headers.location).toBe("https://example.com/receipt");
    await waitFor(async () =>
      expect(await getTransactionalEmailById(row.id)).toMatchObject({
        openCount: 1,
        clickCount: 1,
      }),
    );
  });
});
