import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const notifications = await import("../billing/notifications");
const { encryptSecret } = await import("../utils/secret-crypto");
const { getFeedbackRequirement, notifyFeedbackMilestones } = await import(
  "./feedback-requirement"
);

const tdb = db as unknown as TestDb;
const previousMode = process.env.SENDLIT_DEPLOYMENT_MODE;
const previousThreshold = process.env.BILLING_TEST_VOLUME_THRESHOLD;

beforeEach(async () => {
  await truncateAll(tdb);
  process.env.SENDLIT_DEPLOYMENT_MODE = "cloud";
  process.env.BILLING_TEST_VOLUME_THRESHOLD = "10";
});

afterEach(() => {
  process.env.SENDLIT_DEPLOYMENT_MODE = previousMode;
  process.env.BILLING_TEST_VOLUME_THRESHOLD = previousThreshold;
  if (previousMode === undefined) delete process.env.SENDLIT_DEPLOYMENT_MODE;
  if (previousThreshold === undefined) delete process.env.BILLING_TEST_VOLUME_THRESHOLD;
});

async function setup() {
  const { organization, team } = await seedTeamAndContact(tdb);
  const [esp] = await tdb
    .select()
    .from(schema.espConfigs)
    .where(eq(schema.espConfigs.teamId, team.id));
  return { organization, team, esp };
}

async function accept(teamId: string, espConfigId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const recipient = `r${crypto.randomUUID()}@example.com`;
    await tdb.insert(schema.outboundMessages).values({
      teamId,
      deliverySourceType: "team",
      espConfigId,
      sourceType: "campaign",
      recipientEmail: recipient,
      normalizedRecipient: recipient,
      deliveryStatus: "accepted",
      acceptedAt: new Date(),
    });
  }
}

describe("feedback requirement", () => {
  it("reports the cloud requirement and how far the organization is", async () => {
    const { organization, team, esp } = await setup();
    await accept(team.id, esp.id, 3);

    expect(await getFeedbackRequirement(organization.id)).toEqual({
      required: true,
      requiredAfterSends: 10,
      sentSoFar: 3,
    });
    process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
    expect((await getFeedbackRequirement(organization.id)).required).toBe(false);
  });

  it("emails the owners once each at 50%, 90% and 100% while feedback isn't connected", async () => {
    const { organization, team, esp } = await setup();
    const notify = spyOn(notifications, "notifyOrganizationOwners").mockResolvedValue(
      undefined,
    );
    try {
      await accept(team.id, esp.id, 4);
      await notifyFeedbackMilestones(team.id);
      expect(notify).not.toHaveBeenCalled();

      await accept(team.id, esp.id, 1);
      await notifyFeedbackMilestones(team.id);
      await notifyFeedbackMilestones(team.id);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0][0]).toBe(organization.id);
      expect(notify.mock.calls[0][1]).toContain("5 of 10");

      await accept(team.id, esp.id, 4);
      await notifyFeedbackMilestones(team.id);
      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify.mock.calls[1][1]).toContain("9 of 10");

      await accept(team.id, esp.id, 1);
      await Promise.all([
        notifyFeedbackMilestones(team.id),
        notifyFeedbackMilestones(team.id),
      ]);
      expect(notify).toHaveBeenCalledTimes(3);
      expect(notify.mock.calls[2][1]).toContain("Sending stopped");
      expect(notify.mock.calls[2][2]).toContain(esp.name);

      await accept(team.id, esp.id, 5);
      await notifyFeedbackMilestones(team.id);
      expect(notify).toHaveBeenCalledTimes(3);
    } finally {
      notify.mockRestore();
    }
  });

  it("doesn't email when every ESP already has healthy feedback", async () => {
    const { team, esp } = await setup();
    await tdb.insert(schema.espFeedbackConnections).values({
      teamId: team.id,
      espConfigId: esp.id,
      ownerScope: "team",
      provider: "postmark",
      encryptedCredentials: encryptSecret("webhook-secret"),
      status: "healthy",
    });
    const notify = spyOn(notifications, "notifyOrganizationOwners").mockResolvedValue(
      undefined,
    );
    try {
      await accept(team.id, esp.id, 10);
      await notifyFeedbackMilestones(team.id);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      notify.mockRestore();
    }
  });

  it("does nothing on self-hosted SendLit", async () => {
    process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
    const { team, esp } = await setup();
    const notify = spyOn(notifications, "notifyOrganizationOwners").mockResolvedValue(
      undefined,
    );
    try {
      await accept(team.id, esp.id, 10);
      await notifyFeedbackMilestones(team.id);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      notify.mockRestore();
    }
  });
});
