import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { Email } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../media/service", () => ({
  sealMedia: vi.fn((mediaId: string) =>
    Promise.resolve({
      mediaId,
      file: `https://cdn.test/p/${mediaId}/main.webp`,
    }),
  ),
  deleteMedia: vi.fn(),
}));
mock.module("../media/deletion-queue", () => ({ queueMediaLitDeletion: vi.fn() }));

const { EmailEventAction, EventType } = await import("../config/constants");
const { responses } = await import("../config/strings");
const { db } = await import("../db/client");
const {
  contacts,
  emailContentVersions,
  emailDeliveries,
  emailEvents,
  espConfigs,
  media,
  mediaReferences,
  ongoingSequences,
  rules,
  sequenceEmails,
  sequences,
  teamDeliverySettings,
} = await import("../db/schema");
const { deleteMedia, sealMedia } = await import("../media/service");
const { createEspConfig } = await import("../settings/esp/queries");
const { createTemplate } = await import("../templates/queries");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { defaultEmailContent } = await import("./helpers");
const {
  addMailToSequence,
  countSequences,
  createSequence,
  deleteMailFromSequence,
  deleteSequence,
  getSequenceBySequenceId,
  getSequenceClickThroughRate,
  getSequenceDeletionImpact,
  getSequenceOpenRate,
  getSubscribers,
  getSubscribersCount,
  listSequences,
  pauseSequence,
  setBroadcastArchived,
  startSequence,
  updateMailInSequence,
  updateSequence,
} = await import("./queries");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
  vi.clearAllMocks();
});

async function makeTemplate(teamId: string, title = "Starter") {
  return createTemplate({ teamId, title, content: defaultEmailContent });
}

function emailWithImage(mediaId: string): Email {
  return {
    ...defaultEmailContent,
    content: [
      ...defaultEmailContent.content.slice(0, -1),
      {
        blockType: "image",
        settings: {
          src: `https://cdn.test/i/${mediaId}/main.webp?signature=abc`,
          alt: "Hero",
        },
      },
      defaultEmailContent.content.at(-1)!,
    ],
  };
}

describe("sequence queries", () => {
  it("includes the active entrant count when listing sequences", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });

    await tdb.insert(ongoingSequences).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      nextEmailScheduledTime: Date.now(),
    });

    const items = await listSequences({
      teamId: team.id,
      type: "sequence",
    });
    expect(items.find((item) => item.sequenceId === sequence.sequenceId)).toMatchObject(
      { entrantsCount: 1 },
    );
  });

  it("creates a draft sequence from a team-owned template and adds/removes mails safely", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);

    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    expect(sequence).toMatchObject({
      type: "sequence",
      status: "draft",
      title: "Starter",
      triggerType: EventType.SUBSCRIBER_ADDED,
      viewInBrowser: false,
    });
    expect(sequence.emails).toHaveLength(1);
    expect(sequence.emailsOrder).toEqual([sequence.emails[0].emailId]);

    const withSecond = await addMailToSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      templateId: template.templateId,
    });
    expect(withSecond?.emails).toHaveLength(2);
    const afterDelete = await deleteMailFromSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: withSecond!.emails[0].emailId,
    });
    expect(afterDelete?.emails).toHaveLength(1);
    await expect(
      deleteMailFromSequence({
        teamId: team.id,
        sequenceId: sequence.sequenceId,
        emailId: afterDelete!.emails[0].emailId,
      }),
    ).rejects.toThrow(responses.cannot_delete_last_email);
  });

  it("prevents cross-team template use and broadcast mail mutations after lock", async () => {
    const one = await seedTeamAndContact(tdb);
    const two = await seedTeamAndContact(tdb);
    const template = await makeTemplate(one.team.id);

    await expect(
      createSequence({
        teamId: two.team.id,
        type: "sequence",
        templateId: template.templateId,
      }),
    ).rejects.toThrow(responses.item_not_found);

    const broadcast = await createSequence({
      teamId: one.team.id,
      type: "broadcast",
      templateId: template.templateId,
    });
    expect(broadcast.viewInBrowser).toBe(true);
    await tdb
      .update(sequences)
      .set({
        status: "active",
        report: { broadcast: { lockedAt: Date.now(), sentAt: null } },
      })
      .where(eq(sequences.id, broadcast.id));

    const result = await updateMailInSequence({
      teamId: one.team.id,
      sequenceId: broadcast.sequenceId,
      emailId: broadcast.emails[0].emailId,
      subject: "Should not change",
    });
    expect(result?.emails[0].subject).not.toBe("Should not change");
    // The title is the sent email's subject, so it is locked too.
    await expect(
      updateSequence({
        teamId: one.team.id,
        sequenceId: broadcast.sequenceId,
        title: "Should not change",
      }),
    ).rejects.toThrow(responses.mail_already_sent);
    await expect(
      updateSequence({
        teamId: one.team.id,
        sequenceId: broadcast.sequenceId,
        title: broadcast.title,
      }),
    ).resolves.toMatchObject({ title: broadcast.title });
    await expect(
      addMailToSequence({
        teamId: one.team.id,
        sequenceId: broadcast.sequenceId,
        templateId: template.templateId,
      }),
    ).rejects.toThrow(responses.action_not_allowed);
  });

  it("rejects transactional templates when changing a sequence email template", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const marketingTemplate = await makeTemplate(team.id);
    const transactionalTemplate = await createTemplate({
      teamId: team.id,
      title: "Transactional",
      purpose: "transactional",
      content: {
        ...defaultEmailContent,
        content: defaultEmailContent.content.slice(0, -1),
      },
    });
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: marketingTemplate.templateId,
    });

    await expect(
      updateMailInSequence({
        teamId: team.id,
        sequenceId: sequence.sequenceId,
        emailId: sequence.emails[0].emailId,
        templateId: transactionalTemplate.templateId,
      }),
    ).rejects.toThrow("template_not_marketing");
  });

  it("validates start requirements for sequences and broadcasts", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });

    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow(responses.no_published_emails);

    await tdb
      .update(sequenceEmails)
      .set({ published: true })
      .where(eq(sequenceEmails.id, sequence.emails[0].id));
    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      title: "",
    });
    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow(`${responses.sequence_details_missing}: basics`);

    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      title: "Welcome sequence",
    });
    const [defaultEsp] = await tdb
      .select({ espId: espConfigs.espId })
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    await tdb
      .update(sequences)
      .set({ report: { deliverySourceDeleted: true } })
      .where(eq(sequences.id, sequence.id));
    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toMatchObject({
      status: "active",
      deliverySource: { type: "team", espId: defaultEsp.espId },
      report: {},
    });
    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow(responses.sequence_already_started);

    const broadcast = await createSequence({
      teamId: team.id,
      type: "broadcast",
      templateId: template.templateId,
    });
    await tdb
      .update(sequenceEmails)
      .set({ published: true })
      .where(eq(sequenceEmails.id, broadcast.emails[0].id));
    await expect(
      startSequence({
        teamId: team.id,
        sequenceId: broadcast.sequenceId,
      }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("re-pins a paused sequence before resuming it", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    await tdb
      .update(sequenceEmails)
      .set({ published: true })
      .where(eq(sequenceEmails.id, sequence.emails[0].id));
    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      title: "Welcome sequence",
    });
    await startSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
    });
    await pauseSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
    });

    const [replacement] = await tdb
      .insert(espConfigs)
      .values({
        ownerScope: "team",
        teamId: team.id,
        name: "Replacement ESP",
        host: "smtp.replacement.example.com",
        fromEmail: "replacement@example.com",
        status: "active",
      })
      .returning();
    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      deliverySource: { type: "team", espId: replacement.espId },
    });

    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toMatchObject({
      status: "active",
      deliverySource: { type: "team", espId: replacement.espId },
    });
  });

  it("rejects starting a broadcast with no matching recipients", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await tdb.delete(contacts).where(eq(contacts.teamId, team.id));
    const template = await makeTemplate(team.id);
    const broadcast = await createSequence({
      teamId: team.id,
      type: "broadcast",
      templateId: template.templateId,
    });
    await tdb
      .update(sequenceEmails)
      .set({ published: true })
      .where(eq(sequenceEmails.id, broadcast.emails[0].id));

    await expect(
      startSequence({
        teamId: team.id,
        sequenceId: broadcast.sequenceId,
      }),
    ).rejects.toThrow(responses.broadcast_no_recipients);

    await expect(
      getSequenceBySequenceId(team.id, broadcast.sequenceId),
    ).resolves.toMatchObject({ status: "draft" });
    const createdRules = await tdb
      .select()
      .from(rules)
      .where(eq(rules.sequenceId, broadcast.id));
    expect(createdRules).toHaveLength(0);
  });

  it("does not start or create a rule when no ESP is configured", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    await tdb
      .update(sequenceEmails)
      .set({ published: true })
      .where(eq(sequenceEmails.id, sequence.emails[0].id));
    await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      title: "Welcome sequence",
    });
    await tdb
      .update(teamDeliverySettings)
      .set({ teamEspEnabled: false, defaultSource: null })
      .where(eq(teamDeliverySettings.teamId, team.id));

    await expect(
      startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow("delivery_source_unavailable");

    await expect(
      getSequenceBySequenceId(team.id, sequence.sequenceId),
    ).resolves.toMatchObject({ status: "draft" });
    const createdRules = await tdb
      .select()
      .from(rules)
      .where(eq(rules.sequenceId, sequence.id));
    expect(createdRules).toHaveLength(0);
  });

  it("stores an explicit delivery-source intent on drafts", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const secondEsp = await createEspConfig(team.id, {
      name: "Marketing",
      provider: "smtp",
      host: "marketing.example.com",
      port: 587,
      secure: false,
    });
    const foreignEsp = await createEspConfig(other.team.id, {
      name: "Other team's ESP",
      provider: "smtp",
      host: "other.example.com",
      port: 587,
      secure: false,
    });

    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
      deliverySource: { type: "team", espId: secondEsp.espId },
    });
    expect(sequence.deliverySource).toEqual({
      type: "team",
      espId: secondEsp.espId,
    });

    // Drafts retain an intent for editing. Ownership and availability are
    // resolved once at activation, rather than making draft editing depend
    // on a currently-active ESP.
    await expect(
      createSequence({
        teamId: team.id,
        type: "sequence",
        templateId: template.templateId,
        deliverySource: { type: "team", espId: foreignEsp.espId },
      }),
    ).resolves.toMatchObject({
      deliverySource: { type: "team", espId: foreignEsp.espId },
    });

    const updated = await updateSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      deliverySource: null,
    });
    expect(updated?.deliverySource).toBeNull();
  });

  it("pauses only active, unsent sequences and preserves active broadcast locks", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });

    await expect(
      pauseSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow(responses.sequence_not_active);

    await tdb
      .update(sequences)
      .set({ status: "active" })
      .where(eq(sequences.id, sequence.id));
    await expect(
      pauseSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toMatchObject({ status: "paused" });

    const broadcast = await createSequence({
      teamId: team.id,
      type: "broadcast",
      templateId: template.templateId,
    });
    await tdb
      .update(sequences)
      .set({
        status: "active",
        report: { broadcast: { lockedAt: Date.now(), sentAt: null } },
      })
      .where(eq(sequences.id, broadcast.id));
    await expect(
      pauseSequence({
        teamId: team.id,
        sequenceId: broadcast.sequenceId,
      }),
    ).rejects.toThrow(responses.mail_already_sent);
  });

  it("computes subscribers and engagement rates from delivery/event rows", async () => {
    const { team, contact: firstContact } = await seedTeamAndContact(tdb);
    const [secondContact] = await tdb
      .insert(contacts)
      .values({
        teamId: team.id,
        email: `reader-${crypto.randomUUID()}@example.com`,
        name: "Second Contact",
        unsubscribeToken: crypto.randomUUID(),
      })
      .returning();
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    const secondEmail = await addMailToSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      templateId: template.templateId,
    });
    const [firstEmail, secondEmailRow] = secondEmail!.emails;

    await tdb.insert(emailDeliveries).values([
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: firstContact.id,
        emailId: firstEmail.id,
      },
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: firstContact.id,
        emailId: secondEmailRow.id,
      },
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: secondContact.id,
        emailId: firstEmail.id,
      },
    ]);
    await tdb.insert(emailEvents).values([
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: firstContact.id,
        emailId: firstEmail.id,
        action: EmailEventAction.OPEN,
      },
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: firstContact.id,
        emailId: secondEmailRow.id,
        action: EmailEventAction.OPEN,
      },
      {
        teamId: team.id,
        sequenceId: sequence.id,
        contactId: secondContact.id,
        emailId: firstEmail.id,
        action: EmailEventAction.CLICK,
      },
    ]);

    expect(await getSubscribersCount(sequence.sequenceId)).toBe(2);
    expect((await getSubscribers({ sequenceId: sequence.sequenceId })).sort()).toEqual(
      [firstContact.contactId, secondContact.contactId].sort(),
    );
    expect(await getSequenceOpenRate(sequence.sequenceId)).toBe(0.5);
    expect(await getSequenceClickThroughRate(sequence.sequenceId)).toBe(0.5);
    expect(
      await getSequenceBySequenceId(
        "00000000-0000-0000-0000-000000000000",
        sequence.sequenceId,
      ),
    ).toBeNull();
  });

  it("seals image media and stores references when a sequence email image block is added", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });

    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
      content: emailWithImage("sequence-added-media"),
    });

    expect(sealMedia).toHaveBeenCalledWith("sequence-added-media");
    expect(deleteMedia).not.toHaveBeenCalled();

    const [mediaRow] = await tdb.select().from(media);
    expect(mediaRow).toMatchObject({
      teamId: team.id,
      mediaLitId: "sequence-added-media",
      url: "https://cdn.test/p/sequence-added-media/main.webp",
    });

    const [reference] = await tdb.select().from(mediaReferences);
    expect(reference).toMatchObject({
      teamId: team.id,
      mediaId: mediaRow.id,
      resourceType: "SEQUENCE_EMAIL",
      resourceInternalId: sequence.emails[0].id,
      resourcePublicId: sequence.emails[0].emailId,
      parentResourceInternalId: sequence.id,
      parentResourcePublicId: sequence.sequenceId,
    });
  });

  it("removes only the sequence email reference when an image block is removed", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
      content: emailWithImage("sequence-removed-media"),
    });
    vi.clearAllMocks();

    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
      content: defaultEmailContent,
    });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect(sealMedia).not.toHaveBeenCalled();
    expect(await tdb.select().from(media)).toHaveLength(1);
    expect(
      await tdb
        .select()
        .from(mediaReferences)
        .where(eq(mediaReferences.resourceInternalId, sequence.emails[0].id)),
    ).toHaveLength(0);
  });

  async function sequenceWithImages(
    teamId: string,
    type: "sequence" | "broadcast",
    images: string[],
  ) {
    const template = await makeTemplate(teamId);
    let sequence = await createSequence({
      teamId,
      type,
      templateId: template.templateId,
    });
    for (let index = 1; index < images.length; index++) {
      sequence = (await addMailToSequence({
        teamId,
        sequenceId: sequence.sequenceId,
        templateId: template.templateId,
      }))!;
    }
    for (const [index, image] of images.entries()) {
      await updateMailInSequence({
        teamId,
        sequenceId: sequence.sequenceId,
        emailId: sequence.emails[index].emailId,
        content: emailWithImage(image),
      });
    }
    vi.clearAllMocks();
    return (await getSequenceBySequenceId(teamId, sequence.sequenceId))!;
  }

  /** Records that an email went out, the way a send does. */
  async function markSent(teamId: string, email: { id: string; content: unknown }) {
    await tdb.insert(emailContentVersions).values({
      teamId,
      sequenceEmailId: email.id,
      contentHash: crypto.randomUUID(),
      subject: "Sent",
      content: email.content,
    });
  }

  function deletedMediaLitIds() {
    return (deleteMedia as ReturnType<typeof vi.fn>).mock.calls
      .map(([id]) => id)
      .sort();
  }

  async function remainingMediaLitIds() {
    return (await tdb.select().from(media)).map((row) => row.mediaLitId).sort();
  }

  it("deletes a deleted sequence email's media and keeps media another email uses", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const sequence = await sequenceWithImages(team.id, "sequence", [
      "email-only-media",
      "email-shared-media",
    ]);
    // The second email also shows the first email's shared image.
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
      content: (() => {
        const content = emailWithImage("email-only-media");
        const shared = emailWithImage("email-shared-media").content.find(
          (block) => block.blockType === "image",
        )!;
        return {
          ...content,
          content: [...content.content.slice(0, -1), shared, content.content.at(-1)!],
        };
      })(),
    });
    vi.clearAllMocks();

    await deleteMailFromSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
    });

    expect(deletedMediaLitIds()).toEqual(["email-only-media"]);
    expect(sealMedia).not.toHaveBeenCalled();
    expect(await remainingMediaLitIds()).toEqual(["email-shared-media"]);
    expect(
      await tdb
        .select()
        .from(mediaReferences)
        .where(eq(mediaReferences.resourceInternalId, sequence.emails[0].id)),
    ).toHaveLength(0);
  });

  it("deletes the media of every email of a deleted sequence, keeping shared media", async () => {
    const { team } = await seedTeamAndContact(tdb);
    await createTemplate({
      teamId: team.id,
      title: "Uses the shared image",
      content: emailWithImage("sequence-shared-media"),
    });
    const sequence = await sequenceWithImages(team.id, "sequence", [
      "sequence-media-1",
      "sequence-media-2",
      "sequence-shared-media",
    ]);

    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(true);

    expect(deletedMediaLitIds()).toEqual(["sequence-media-1", "sequence-media-2"]);
    expect(await remainingMediaLitIds()).toEqual(["sequence-shared-media"]);
  });

  it("deletes a draft broadcast's media", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const broadcast = await sequenceWithImages(team.id, "broadcast", [
      "broadcast-deleted-media",
    ]);

    await expect(
      deleteSequence({ teamId: team.id, sequenceId: broadcast.sequenceId }),
    ).resolves.toBe(true);

    expect(deletedMediaLitIds()).toEqual(["broadcast-deleted-media"]);
    expect(sealMedia).not.toHaveBeenCalled();
    expect(await remainingMediaLitIds()).toEqual([]);
    expect(await tdb.select().from(mediaReferences)).toHaveLength(0);
    expect(await getSequenceBySequenceId(team.id, broadcast.sequenceId)).toBeNull();
  });

  it("keeps the media of a sent broadcast", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const broadcast = await sequenceWithImages(team.id, "broadcast", [
      "broadcast-sent-media",
    ]);
    await markSent(team.id, broadcast.emails[0]);

    await deleteSequence({ teamId: team.id, sequenceId: broadcast.sequenceId });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect(await remainingMediaLitIds()).toEqual(["broadcast-sent-media"]);
  });

  it("keeps media a sent sequence email shows when a draft email is deleted", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const sequence = await sequenceWithImages(team.id, "sequence", [
      "sequence-sent-media",
      "sequence-sent-media",
      "sequence-draft-media",
    ]);
    await markSent(team.id, sequence.emails[0]);

    // The draft copy of the sent image goes, the sent email still shows it.
    await deleteMailFromSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[1].emailId,
    });
    expect(deleteMedia).not.toHaveBeenCalled();

    await deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId });

    expect(deletedMediaLitIds()).toEqual(["sequence-draft-media"]);
    expect(await remainingMediaLitIds()).toEqual(["sequence-sent-media"]);
  });
});

describe("deleteSequence guards and history", () => {
  async function setStatus(id: string, status: string) {
    await tdb.update(sequences).set({ status }).where(eq(sequences.id, id));
  }

  /** A sequence with one contact enrolled, one delivery and one open. */
  async function sequenceWithHistory(type: "sequence" | "broadcast" = "sequence") {
    const { team, contact } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type,
      templateId: template.templateId,
    });
    const email = sequence.emails[0];
    await tdb.insert(ongoingSequences).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      nextEmailScheduledTime: Date.now(),
    });
    await tdb.insert(emailDeliveries).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      emailId: email.id,
    });
    await tdb.insert(emailEvents).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      emailId: email.id,
      action: EmailEventAction.OPEN,
    });
    return { team, contact, sequence };
  }

  it("refuses to delete an active sequence and keeps everything", async () => {
    const { team, sequence } = await sequenceWithHistory();
    await setStatus(sequence.id, "active");

    await expect(
      getSequenceDeletionImpact(team.id, sequence.sequenceId),
    ).resolves.toEqual({
      status: "active",
      blocker: "sequence_active",
      enrolledCount: 1,
      emailsSentCount: 1,
    });
    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow("sequence_active");

    expect(await getSequenceBySequenceId(team.id, sequence.sequenceId)).not.toBeNull();
    expect(await tdb.select().from(ongoingSequences)).toHaveLength(1);
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(1);
    expect(await tdb.select().from(emailEvents)).toHaveLength(1);
  });

  it("refuses to delete a sending broadcast", async () => {
    const { team, sequence } = await sequenceWithHistory("broadcast");
    await setStatus(sequence.id, "active");

    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).rejects.toThrow("sequence_active");
    expect(await getSequenceBySequenceId(team.id, sequence.sequenceId)).not.toBeNull();
  });

  it("deletes a paused sequence with its enrollments and history", async () => {
    const { team, contact, sequence } = await sequenceWithHistory();
    await setStatus(sequence.id, "paused");

    await expect(
      getSequenceDeletionImpact(team.id, sequence.sequenceId),
    ).resolves.toEqual({
      status: "paused",
      blocker: null,
      enrolledCount: 1,
      emailsSentCount: 1,
    });
    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(true);

    expect(await getSequenceBySequenceId(team.id, sequence.sequenceId)).toBeNull();
    expect(await tdb.select().from(ongoingSequences)).toHaveLength(0);
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(0);
    expect(await tdb.select().from(emailEvents)).toHaveLength(0);
    expect(await tdb.select().from(rules)).toHaveLength(0);
    expect(await tdb.select().from(sequenceEmails)).toHaveLength(0);
    // The contact itself stays.
    expect(
      await tdb.select().from(contacts).where(eq(contacts.id, contact.id)),
    ).toHaveLength(1);
  });

  it("deletes a never-started draft", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });

    await expect(
      getSequenceDeletionImpact(team.id, sequence.sequenceId),
    ).resolves.toEqual({
      status: "draft",
      blocker: null,
      enrolledCount: 0,
      emailsSentCount: 0,
    });
    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(true);
    expect(await tdb.select().from(sequences)).toHaveLength(0);
  });

  it("never deletes or previews another team's sequence", async () => {
    const { sequence } = await sequenceWithHistory();
    await setStatus(sequence.id, "paused");
    const other = await seedTeamAndContact(tdb);

    await expect(
      getSequenceDeletionImpact(other.team.id, sequence.sequenceId),
    ).resolves.toBeNull();
    await expect(
      deleteSequence({ teamId: other.team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(false);
    expect(await tdb.select().from(sequences)).toHaveLength(1);
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(1);
  });

  it("keeps the images of an email that was delivered, even after its deliveries go", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const sequence = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: sequence.sequenceId,
      emailId: sequence.emails[0].emailId,
      content: emailWithImage("delivered-media"),
    });
    await tdb.insert(emailDeliveries).values({
      teamId: team.id,
      sequenceId: sequence.id,
      contactId: contact.id,
      emailId: sequence.emails[0].id,
    });
    await setStatus(sequence.id, "paused");
    vi.clearAllMocks();

    await deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect((await tdb.select().from(media)).map((row) => row.mediaLitId)).toEqual([
      "delivered-media",
    ]);
    expect(await tdb.select().from(mediaReferences)).toHaveLength(0);
  });
});

describe("broadcast delete and archive (#147)", () => {
  /** A broadcast whose email shows `mediaId`, in the given state. */
  async function broadcast(
    state: "draft" | "scheduled" | "sending" | "sent" | "paused_mid_send",
    mediaId = "broadcast-media",
  ) {
    const { team, contact } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const created = await createSequence({
      teamId: team.id,
      type: "broadcast",
      templateId: template.templateId,
    });
    await updateMailInSequence({
      teamId: team.id,
      sequenceId: created.sequenceId,
      emailId: created.emails[0].emailId,
      content: emailWithImage(mediaId),
    });
    const email = created.emails[0];
    const lockedAt = Date.now() - 60_000;
    if (state === "scheduled") {
      await tdb
        .update(sequenceEmails)
        .set({ delayInMillis: Date.now() + 86_400_000 })
        .where(eq(sequenceEmails.id, email.id));
      await tdb.insert(rules).values({
        teamId: team.id,
        sequenceId: created.id,
        event: EventType.DATE_OCCURRED,
        eventDateInMillis: Date.now() + 86_400_000,
      });
    }
    const status = {
      draft: "draft",
      scheduled: "active",
      sending: "active",
      sent: "completed",
      paused_mid_send: "paused",
    }[state];
    const started = ["sending", "sent", "paused_mid_send"].includes(state);
    await tdb
      .update(sequences)
      .set({
        status,
        report: started ? { broadcast: { lockedAt, sentAt: null } } : {},
      })
      .where(eq(sequences.id, created.id));
    if (started) {
      await tdb.insert(emailDeliveries).values({
        teamId: team.id,
        sequenceId: created.id,
        contactId: contact.id,
        emailId: email.id,
      });
      await tdb.insert(emailEvents).values({
        teamId: team.id,
        sequenceId: created.id,
        contactId: contact.id,
        emailId: email.id,
        action: EmailEventAction.OPEN,
      });
    }
    vi.clearAllMocks();
    return { team, sequence: created };
  }

  const mediaLitIds = async () =>
    (await tdb.select().from(media)).map((row) => row.mediaLitId);

  it("deletes a draft broadcast and its unused image", async () => {
    const { team, sequence } = await broadcast("draft");
    expect(await mediaLitIds()).toEqual(["broadcast-media"]);

    await expect(
      getSequenceDeletionImpact(team.id, sequence.sequenceId),
    ).resolves.toMatchObject({ blocker: null, emailsSentCount: 0 });
    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(true);

    expect(await tdb.select().from(sequences)).toHaveLength(0);
    expect(deleteMedia).toHaveBeenCalledWith("broadcast-media");
    expect(await mediaLitIds()).toEqual([]);
    expect(await tdb.select().from(mediaReferences)).toHaveLength(0);
  });

  it("deletes a scheduled broadcast with its schedule", async () => {
    const { team, sequence } = await broadcast("scheduled");
    expect(await tdb.select().from(rules)).toHaveLength(1);

    await expect(
      deleteSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
    ).resolves.toBe(true);

    expect(await tdb.select().from(sequences)).toHaveLength(0);
    expect(await tdb.select().from(rules)).toHaveLength(0);
    expect(deleteMedia).toHaveBeenCalledWith("broadcast-media");
  });

  it("refuses to delete or archive a broadcast while it is sending", async () => {
    const { team, sequence } = await broadcast("sending");
    const ids = { teamId: team.id, sequenceId: sequence.sequenceId };

    await expect(deleteSequence(ids)).rejects.toThrow("sequence_active");
    await expect(setBroadcastArchived({ ...ids, archived: true })).rejects.toThrow(
      "sequence_active",
    );
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(1);
  });

  it("refuses to delete a sent broadcast and archives it with its report and images", async () => {
    const { team, sequence } = await broadcast("sent");
    const ids = { teamId: team.id, sequenceId: sequence.sequenceId };

    await expect(getSequenceDeletionImpact(team.id, ids.sequenceId)).resolves.toEqual({
      status: "completed",
      blocker: "broadcast_sent",
      enrolledCount: 0,
      emailsSentCount: 1,
    });
    await expect(deleteSequence(ids)).rejects.toThrow("broadcast_sent");

    const archived = await setBroadcastArchived({ ...ids, archived: true });
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.status).toBe("completed");
    expect(await tdb.select().from(emailDeliveries)).toHaveLength(1);
    expect(await tdb.select().from(emailEvents)).toHaveLength(1);
    expect(await getSequenceOpenRate(ids.sequenceId)).toBeGreaterThan(0);
    expect(deleteMedia).not.toHaveBeenCalled();
    expect(await mediaLitIds()).toEqual(["broadcast-media"]);
    expect(await tdb.select().from(mediaReferences)).toHaveLength(1);

    // Hidden from the default list, shown under "Archived".
    const list = (archived: "exclude" | "only" | "include" = "exclude") =>
      listSequences({ teamId: team.id, type: "broadcast", archived });
    expect(await list()).toHaveLength(0);
    expect((await list("only")).map((item) => item.sequenceId)).toEqual([
      ids.sequenceId,
    ]);
    expect(await list("include")).toHaveLength(1);
    expect(await countSequences(team.id, "broadcast")).toBe(0);
    expect(await countSequences(team.id, "broadcast", "only")).toBe(1);

    // Still can't be deleted once archived.
    await expect(deleteSequence(ids)).rejects.toThrow("broadcast_sent");

    const restored = await setBroadcastArchived({ ...ids, archived: false });
    expect(restored?.archivedAt).toBeNull();
    expect(await list()).toHaveLength(1);
    expect(await list("only")).toHaveLength(0);
  });

  it("archives a broadcast paused mid-send, which can't resume until restored", async () => {
    const { team, sequence } = await broadcast("paused_mid_send");
    const ids = { teamId: team.id, sequenceId: sequence.sequenceId };
    await expect(deleteSequence(ids)).rejects.toThrow("broadcast_sent");

    await setBroadcastArchived({ ...ids, archived: true });
    await expect(startSequence(ids)).rejects.toThrow(responses.broadcast_archived);
  });

  it("only archives sent broadcasts", async () => {
    const draft = await broadcast("draft");
    await expect(
      setBroadcastArchived({
        teamId: draft.team.id,
        sequenceId: draft.sequence.sequenceId,
        archived: true,
      }),
    ).rejects.toThrow("broadcast_not_sent");

    const { team } = await seedTeamAndContact(tdb);
    const template = await makeTemplate(team.id);
    const multiStep = await createSequence({
      teamId: team.id,
      type: "sequence",
      templateId: template.templateId,
    });
    await expect(
      setBroadcastArchived({
        teamId: team.id,
        sequenceId: multiStep.sequenceId,
        archived: true,
      }),
    ).resolves.toBeNull();
  });

  it("never archives, restores or deletes another team's broadcast", async () => {
    const { sequence } = await broadcast("sent");
    const other = await seedTeamAndContact(tdb);
    const ids = { teamId: other.team.id, sequenceId: sequence.sequenceId };

    await expect(setBroadcastArchived({ ...ids, archived: true })).resolves.toBeNull();
    await expect(setBroadcastArchived({ ...ids, archived: false })).resolves.toBeNull();
    await expect(deleteSequence(ids)).resolves.toBe(false);
    const [row] = await tdb.select().from(sequences);
    expect(row.archivedAt).toBeNull();
    expect(
      await listSequences({
        teamId: other.team.id,
        type: "broadcast",
        archived: "include",
      }),
    ).toHaveLength(0);
  });
});
