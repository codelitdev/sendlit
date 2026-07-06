import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import {
    contacts,
    emailDeliveries,
    emailEvents,
    sequences,
    sequenceEmails,
} from "../db/schema";
import { EmailEventAction, EventType } from "../config/constants";
import { responses } from "../config/strings";
import { createTemplate } from "../templates/queries";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import {
    addMailToSequence,
    createSequence,
    deleteMailFromSequence,
    getSequenceBySequenceId,
    getSequenceClickThroughRate,
    getSequenceOpenRate,
    getSubscribers,
    getSubscribersCount,
    pauseSequence,
    startSequence,
    updateMailInSequence,
    updateSequence,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
});

async function makeTemplate(teamId: string, title = "Starter") {
    return createTemplate({ teamId, title, content: defaultEmail });
}

describe("sequence queries", () => {
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
        await expect(
            addMailToSequence({
                teamId: one.team.id,
                sequenceId: broadcast.sequenceId,
                templateId: template.templateId,
            }),
        ).rejects.toThrow(responses.action_not_allowed);
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
        await expect(
            startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
        ).resolves.toMatchObject({ status: "active" });
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
        ).rejects.toThrow(`${responses.sequence_details_missing}: filter`);
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
        expect(
            (await getSubscribers({ sequenceId: sequence.sequenceId })).sort(),
        ).toEqual([firstContact.contactId, secondContact.contactId].sort());
        expect(await getSequenceOpenRate(sequence.sequenceId)).toBe(0.5);
        expect(await getSequenceClickThroughRate(sequence.sequenceId)).toBe(
            0.5,
        );
        expect(
            await getSequenceBySequenceId(
                "00000000-0000-0000-0000-000000000000",
                sequence.sequenceId,
            ),
        ).toBeNull();
    });
});
