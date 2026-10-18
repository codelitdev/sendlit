import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { emailSuppressionActions } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const {
  addOrStrengthenSuppression,
  getActiveSuppression,
  isRecipientSuppressed,
  releaseSuppression,
} = await import("./suppression-queries");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("suppression queries (integration)", () => {
  it("suppresses, enforces send-path checks, strengthens reason, and audits", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const email = "  Bounce@Example.COM ";

    expect(await isRecipientSuppressed(team.id, email)).toBe(false);

    const created = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: email,
      reason: "repeated_soft_bounce",
      actorType: "system",
    });
    expect(created.active).toBe(true);
    expect(created.normalizedRecipient).toBe("bounce@example.com");
    expect(await isRecipientSuppressed(team.id, "bounce@example.com")).toBe(true);

    // Stronger reason wins; weaker does not downgrade.
    const strengthened = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "bounce@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });
    expect(strengthened.id).toBe(created.id);
    expect(strengthened.reason).toBe("hard_bounce");

    const notWeaker = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "bounce@example.com",
      reason: "manual",
      actorType: "workspace_user",
    });
    expect(notWeaker.reason).toBe("hard_bounce");

    const actions = await tdb.select().from(emailSuppressionActions);
    expect(actions.map((a) => a.action).sort()).toEqual(["created", "reason_changed"]);
  });

  it("releases owner-releasable reasons and re-suppresses after a new signal", async () => {
    const { team, account } = await seedTeamAndContact(tdb);

    const row = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "ada@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });

    const released = await releaseSuppression({
      teamId: team.id,
      suppressionId: row.suppressionId,
      actorType: "workspace_user",
      actorUserId: account.id,
      explanation: "fixed mailbox",
    });
    expect(released.active).toBe(false);
    expect(await getActiveSuppression(team.id, "ada@example.com")).toBeNull();

    // Fresh hard bounce must re-suppress (cannot stay hidden by old release).
    const reactivated = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "ada@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });
    expect(reactivated.id).toBe(row.id);
    expect(reactivated.active).toBe(true);

    const actions = await tdb.select().from(emailSuppressionActions);
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["released", "reactivated"]),
    );
  });

  it("blocks workspace users from releasing complaint suppressions", async () => {
    const { team, account } = await seedTeamAndContact(tdb);
    const row = await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "spam@example.com",
      reason: "complaint",
      actorType: "system",
    });

    await expect(
      releaseSuppression({
        teamId: team.id,
        suppressionId: row.suppressionId,
        actorType: "workspace_user",
        actorUserId: account.id,
      }),
    ).rejects.toThrow("suppression_not_releasable");

    // Operators can still release.
    const released = await releaseSuppression({
      teamId: team.id,
      suppressionId: row.suppressionId,
      actorType: "sendlit_operator",
      explanation: "false positive",
    });
    expect(released.active).toBe(false);
  });
});
