import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { seedSequence } = await import("../test/fixtures");
const { encryptSecret } = await import("../utils/secret-crypto");
const { sequenceDeliveryRates } = await import("../automation/sending-health");
const { getDeliveriesByContact } = await import("../contacts/queries");
const { deliveryOutcome, listSequenceDeliveries } = await import("./delivery-outcomes");
const { addOrStrengthenSuppression } = await import("./suppression-queries");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

/** A sequence with one email sent to three contacts: one delivered, one
 * hard-bounced (with a provider event) and one marked as spam. */
async function seedSends() {
  const { team, contact } = await seedTeamAndContact(tdb);
  const [esp] = await tdb
    .select()
    .from(schema.espConfigs)
    .where(eq(schema.espConfigs.teamId, team.id));
  const [connection] = await tdb
    .insert(schema.espFeedbackConnections)
    .values({
      teamId: team.id,
      espConfigId: esp.id,
      ownerScope: "team",
      provider: "postmark",
      encryptedCredentials: encryptSecret("webhook-secret"),
      status: "healthy",
    })
    .returning();
  const { sequenceRow, emailRows } = await seedSequence(tdb, {
    teamId: team.id,
    emails: [{ emailId: "email_welcome", subject: "Welcome" }],
  });
  const others = await tdb
    .insert(schema.contacts)
    .values([
      {
        teamId: team.id,
        email: "bounced@example.com",
        unsubscribeToken: crypto.randomUUID(),
      },
      {
        teamId: team.id,
        email: "spam@example.com",
        unsubscribeToken: crypto.randomUUID(),
      },
    ])
    .returning();
  const [bouncedContact, spamContact] = others;

  async function send(
    contactRow: { id: string; email: string },
    projection: Partial<typeof schema.outboundMessages.$inferInsert>,
    sentAt: Date,
  ) {
    const [delivery] = await tdb
      .insert(schema.emailDeliveries)
      .values({
        teamId: team.id,
        sequenceId: sequenceRow.id,
        contactId: contactRow.id,
        emailId: emailRows[0].id,
        createdAt: sentAt,
      })
      .returning();
    const [outbound] = await tdb
      .insert(schema.outboundMessages)
      .values({
        teamId: team.id,
        deliverySourceType: "team",
        espConfigId: esp.id,
        feedbackConnectionId: connection.id,
        sourceType: "campaign",
        campaignDeliveryId: delivery.id,
        recipientEmail: contactRow.email,
        normalizedRecipient: contactRow.email,
        provider: "postmark",
        deliveryStatus: "accepted",
        acceptedAt: sentAt,
        ...projection,
      })
      .returning();
    return outbound;
  }

  const delivered = await send(
    contact,
    { deliveryStatus: "delivered", deliveredAt: new Date("2026-11-01T00:01:00Z") },
    new Date("2026-11-01T00:00:00Z"),
  );
  const bounced = await send(
    bouncedContact,
    { deliveryStatus: "bounced", bouncedAt: new Date("2026-11-01T00:03:00Z") },
    new Date("2026-11-01T00:00:00Z"),
  );
  const complained = await send(
    spamContact,
    {
      deliveryStatus: "delivered",
      deliveredAt: new Date("2026-11-01T00:01:00Z"),
      feedbackStatus: "complained",
      complainedAt: new Date("2026-11-02T00:00:00Z"),
    },
    new Date("2026-11-01T00:00:00Z"),
  );

  const [receipt] = await tdb
    .insert(schema.espWebhookReceipts)
    .values({
      connectionId: connection.id,
      teamId: team.id,
      provider: "postmark",
      bodySha256: "abc",
      status: "processed",
    })
    .returning();
  const [bounceEvent] = await tdb
    .insert(schema.emailDeliveryEvents)
    .values({
      receiptId: receipt.id,
      connectionId: connection.id,
      teamId: team.id,
      outboundMessageId: bounced.id,
      provider: "postmark",
      providerEventKey: "bounce-1",
      normalizedRecipient: bouncedContact.email,
      eventType: "hard_bounce",
      bounceClass: "permanent",
      smtpCode: 550,
      enhancedStatusCode: "5.1.1",
      reason: "user unknown",
      occurredAt: new Date("2026-11-01T00:03:00Z"),
      receivedAt: new Date("2026-11-01T00:03:00Z"),
    })
    .returning();
  await addOrStrengthenSuppression({
    teamId: team.id,
    recipientEmail: bouncedContact.email,
    reason: "hard_bounce",
    sourceEventId: bounceEvent.id,
    actorType: "system",
  });

  return {
    team,
    contact,
    sequenceRow,
    bouncedContact,
    spamContact,
    delivered,
    bounced,
    complained,
  };
}

describe("deliveryOutcome", () => {
  it("puts a complaint ahead of the delivery status", () => {
    expect(deliveryOutcome("delivered", "complained")).toBe("complained");
    expect(deliveryOutcome("bounced", "none")).toBe("bounced");
    expect(deliveryOutcome("delivered", "none")).toBe("delivered");
    expect(deliveryOutcome("accepted", "none")).toBe("sent");
    expect(deliveryOutcome("delayed", "none")).toBe("sent");
    expect(deliveryOutcome("cancelled", "none")).toBe("failed");
  });
});

describe("listSequenceDeliveries", () => {
  it("lists every send, most recent outcome first", async () => {
    const { team, sequenceRow } = await seedSends();
    const page = await listSequenceDeliveries({
      teamId: team.id,
      sequenceId: sequenceRow.id,
    });
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.outcome)).toEqual([
      "complained",
      "bounced",
      "delivered",
    ]);
  });

  it("lists the bounced recipients the bounce rate counts, with the reason and suppression", async () => {
    const { team, sequenceRow, bouncedContact, bounced } = await seedSends();
    const page = await listSequenceDeliveries({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      outcome: "bounced",
    });
    const rates = await sequenceDeliveryRates(sequenceRow.id);
    expect(page.total).toBe(rates.bounced);
    expect(page.items).toEqual([
      {
        messageId: bounced.messageId,
        contactId: bouncedContact.contactId,
        email: "bounced@example.com",
        emailId: "email_welcome",
        outcome: "bounced",
        bounceType: "hard",
        reason: "user unknown",
        smtpCode: 550,
        enhancedStatusCode: "5.1.1",
        occurredAt: "2026-11-01T00:03:00.000Z",
        suppression: { suppressionId: expect.any(String), reason: "hard_bounce" },
      },
    ]);
  });

  it("lists the recipients who complained, matching the complaint rate", async () => {
    const { team, sequenceRow, spamContact } = await seedSends();
    const page = await listSequenceDeliveries({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      outcome: "complained",
    });
    const rates = await sequenceDeliveryRates(sequenceRow.id);
    expect(page.total).toBe(rates.complained);
    expect(page.items).toMatchObject([
      {
        contactId: spamContact.contactId,
        outcome: "complained",
        bounceType: null,
        occurredAt: "2026-11-02T00:00:00.000Z",
        suppression: null,
      },
    ]);
  });

  it("treats a bounce with no provider event as an inline hard bounce", async () => {
    const { team, sequenceRow, bounced } = await seedSends();
    await tdb
      .update(schema.emailSuppressions)
      .set({ sourceEventId: null })
      .where(eq(schema.emailSuppressions.teamId, team.id));
    await tdb
      .delete(schema.emailDeliveryEvents)
      .where(eq(schema.emailDeliveryEvents.outboundMessageId, bounced.id));
    const page = await listSequenceDeliveries({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      outcome: "bounced",
    });
    expect(page.items[0]).toMatchObject({ bounceType: "hard", reason: null });
  });

  it("pages and never shows another team's sends", async () => {
    const { team, sequenceRow } = await seedSends();
    const second = await listSequenceDeliveries({
      teamId: team.id,
      sequenceId: sequenceRow.id,
      offset: 2,
      rowsPerPage: 2,
    });
    expect(second.total).toBe(3);
    expect(second.items.map((item) => item.outcome)).toEqual(["delivered"]);

    const { team: otherTeam } = await seedTeamAndContact(tdb);
    expect(
      await listSequenceDeliveries({
        teamId: otherTeam.id,
        sequenceId: sequenceRow.id,
      }),
    ).toEqual({ items: [], total: 0 });
  });
});

describe("contact delivery history", () => {
  it("shows each send's outcome", async () => {
    const { team, contact, spamContact, bouncedContact, delivered } = await seedSends();
    expect(await getDeliveriesByContact(team.id, contact.id)).toMatchObject([
      { messageId: delivered.messageId, outcome: "delivered" },
    ]);
    expect(await getDeliveriesByContact(team.id, bouncedContact.id)).toMatchObject([
      { outcome: "bounced" },
    ]);
    expect(await getDeliveriesByContact(team.id, spamContact.id)).toMatchObject([
      { outcome: "complained" },
    ]);
  });
});
