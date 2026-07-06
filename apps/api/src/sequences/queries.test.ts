import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

import { db } from "../db/client";
import {
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
        await expect(
            startSequence({ teamId: team.id, sequenceId: sequence.sequenceId }),
        ).rejects.toThrow(`${responses.sequence_details_missing}: basics`);

        await updateSequence({
            teamId: team.id,
            sequenceId: sequence.sequenceId,
            fromName: "Sender",
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
        const { team } = await seedTeamAndContact(tdb);
        const template = await makeTemplate(team.id);
        const sequence = await createSequence({
            teamId: team.id,
            type: "sequence",
            templateId: template.templateId,
        });

        await tdb.insert(emailDeliveries).values([
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-1",
                emailId: "email-1",
            },
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-1",
                emailId: "email-2",
            },
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-2",
                emailId: "email-1",
            },
        ]);
        await tdb.insert(emailEvents).values([
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-1",
                emailId: "email-1",
                action: EmailEventAction.OPEN,
            },
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-1",
                emailId: "email-2",
                action: EmailEventAction.OPEN,
            },
            {
                teamId: team.id,
                sequenceId: sequence.sequenceId,
                contactId: "contact-2",
                emailId: "email-1",
                action: EmailEventAction.CLICK,
            },
        ]);

        expect(await getSubscribersCount(sequence.sequenceId)).toBe(2);
        expect(
            await getSubscribers({ sequenceId: sequence.sequenceId }),
        ).toEqual(["contact-1", "contact-2"]);
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
