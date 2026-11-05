import type { Email as EmailContent } from "@sendlit/email-editor";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { assertEmailContentAllowed } from "../abuse/content-scan";
import { db } from "../db/client";
import {
  emailContentVersions,
  ongoingSequences,
  sequenceEmails,
  sequences,
} from "../db/schema";
import { syncEmailContentMediaReferences } from "../media/email-content";
import { captureEvent } from "../observability";
import { getOrCreateContentVersion } from "./content-versions";
import { draftPatch, editsAreDrafts, hasDraft, noDraft } from "./drafts";
import {
  emailMediaResource,
  getSequenceBySequenceId,
  type HydratedSequence,
  isBroadcastLocked,
  type SequenceEmail,
} from "./queries";

/**
 * Who gets published changes in a running sequence: `in_flight` (default)
 * also gives them to contacts already in it at their next step;
 * `new_entrants` keeps those contacts on the version they entered with.
 */
export const publishScopes = ["in_flight", "new_entrants"] as const;
export type PublishScope = (typeof publishScopes)[number];

/** The emails of `sequence` named by `emailIds` (all when omitted), or
 * `email_not_found` for an id it doesn't have. */
function selectEmails(sequence: HydratedSequence, emailIds?: string[]) {
  if (!emailIds) return sequence.emails;
  const byId = new Map(sequence.emails.map((email) => [email.emailId, email]));
  return [...new Set(emailIds)].map((emailId) => {
    const email = byId.get(emailId);
    if (!email) throw new Error("email_not_found");
    return email;
  });
}

/** Records that a version has been live, for one that predates version
 * history: since it was first stored, which is when it was first sent. */
async function markWasLive(tx: Pick<typeof db, "update">, versionId: string) {
  await tx
    .update(emailContentVersions)
    .set({
      publishedAt: sql`COALESCE(${emailContentVersions.publishedAt}, LEAST(${emailContentVersions.createdAt}, now() - interval '1 millisecond'))`,
    })
    .where(eq(emailContentVersions.id, versionId));
}

/**
 * Publishes the drafts of a broadcast's or sequence's emails (`emailIds`,
 * or every email with a draft): later sends use them. Emails without a
 * draft are left alone. Each published version is kept in the email's
 * history (`listEmailVersions`), including the one it replaces, so a
 * publish can be rolled back with `restoreEmailVersion`.
 *
 * With `scope: "new_entrants"`, contacts already in a sequence who haven't
 * got the email yet keep getting the version they entered with. Published
 * content passes the hosted content scan first, as when a sequence starts.
 * Returns null when there is no such sequence.
 */
export async function publishEmailChanges({
  teamId,
  sequenceId,
  emailIds,
  scope = "in_flight",
}: {
  teamId: string;
  sequenceId: string;
  emailIds?: string[];
  scope?: PublishScope;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  // What a sent broadcast's recipients got can't change any more.
  if (isBroadcastLocked(sequence)) throw new Error("mail_already_sent");
  const drafts = selectEmails(sequence, emailIds).filter(hasDraft);
  if (drafts.length === 0) return sequence;

  for (const email of drafts) {
    await assertEmailContentAllowed({
      teamId,
      email,
      subject: email.draftSubject!,
      content: email.draftContent,
    });
  }

  const now = new Date();
  // Only contacts in a sequence can be kept on an earlier version; a
  // broadcast has none until it sends, and then it can't be edited.
  const pinInFlight = scope === "new_entrants" && sequence.type === "sequence";
  for (const email of drafts) {
    const [previous, next] = await Promise.all([
      getOrCreateContentVersion({ ...email, teamId }),
      getOrCreateContentVersion({
        id: email.id,
        teamId,
        subject: email.draftSubject!,
        content: email.draftContent,
      }),
    ]);
    await db.transaction(async (tx) => {
      // The version being replaced was live until now, so it's history.
      // Timestamps come from the database, which also stamped `created_at`,
      // so the replaced version always sorts before the new one.
      await markWasLive(tx, previous.id);
      await tx
        .update(emailContentVersions)
        .set({ publishedAt: sql`now()` })
        .where(eq(emailContentVersions.id, next.id));
      // A broadcast's title is its published subject.
      if (sequence.type === "broadcast") {
        await tx
          .update(sequences)
          .set({ title: email.draftSubject!, updatedAt: now })
          .where(eq(sequences.id, sequence.id));
      }
      // Guarded on the draft read above, so an edit saved meanwhile stays a
      // draft instead of going live unscanned.
      const [published] = await tx
        .update(sequenceEmails)
        .set({
          subject: email.draftSubject!,
          content: email.draftContent as any,
          ...noDraft,
          updatedAt: now,
        })
        .where(
          and(
            eq(sequenceEmails.id, email.id),
            email.draftUpdatedAt
              ? eq(sequenceEmails.draftUpdatedAt, email.draftUpdatedAt)
              : isNull(sequenceEmails.draftUpdatedAt),
          ),
        )
        .returning({ id: sequenceEmails.id });
      if (!published) throw new Error("draft_changed");

      const emailKey = sql`${email.emailId}::text`;
      await tx
        .update(ongoingSequences)
        .set({
          pinnedVersions: pinInFlight
            ? // Keep contacts who haven't had it yet on what they'd get today;
              // one already kept on an older version stays on that.
              sql`COALESCE(${ongoingSequences.pinnedVersions}, '{}'::jsonb) || jsonb_build_object(${emailKey}, COALESCE(${ongoingSequences.pinnedVersions}->>${emailKey}, ${previous.id}::text))`
            : // Everyone in the sequence gets the new version.
              sql`NULLIF(${ongoingSequences.pinnedVersions} - ${emailKey}, '{}'::jsonb)`,
        })
        .where(
          and(
            eq(ongoingSequences.sequenceId, sequence.id),
            sql`NOT (${email.emailId} = ANY(${ongoingSequences.sentEmailIds}))`,
            pinInFlight ? undefined : isNotNull(ongoingSequences.pinnedVersions),
          ),
        );
    });
    // The draft's images are the email's only ones now.
    await syncEmailContentMediaReferences({
      teamId,
      content: email.draftContent as EmailContent,
      resource: emailMediaResource(sequence, email),
    });
  }

  captureEvent({
    event: "sequence_changes_published",
    source: "sequences.publish_changes",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      sequence_status: sequence.status,
      emails_count: drafts.length,
      publish_scope: scope,
    },
  });
  return getSequenceBySequenceId(teamId, sequenceId);
}

/**
 * Throws away the drafts of the given emails (all when omitted), so the
 * editor shows the published version again.
 */
export async function discardEmailChanges({
  teamId,
  sequenceId,
  emailIds,
}: {
  teamId: string;
  sequenceId: string;
  emailIds?: string[];
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  const drafts = selectEmails(sequence, emailIds).filter(hasDraft);
  if (drafts.length === 0) return sequence;

  await db.transaction(async (tx) => {
    for (const email of drafts) {
      await tx
        .update(sequenceEmails)
        .set({ ...noDraft, updatedAt: new Date() })
        .where(eq(sequenceEmails.id, email.id));
    }
  });
  // Images only the draft used are no longer referenced.
  for (const email of drafts) {
    await syncEmailContentMediaReferences({
      teamId,
      content: email.content as EmailContent,
      resource: emailMediaResource(sequence, email),
    });
  }

  captureEvent({
    event: "sequence_changes_discarded",
    source: "sequences.discard_changes",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      emails_count: drafts.length,
    },
  });
  return getSequenceBySequenceId(teamId, sequenceId);
}

const VERSION_HISTORY_LIMIT = 20;

export type PublishedEmailVersion = {
  versionId: string;
  subject: string;
  content: unknown;
  publishedAt: Date;
  /** Whether this is the version sends use now. */
  live: boolean;
};

/** The versions an email has been published with, newest first (at most
 * 20). The one it sends now is `live`; before its first publish there is
 * no history yet and only the live version is listed. */
export async function listEmailVersions({
  teamId,
  sequenceId,
  emailId,
}: {
  teamId: string;
  sequenceId: string;
  emailId: string;
}): Promise<PublishedEmailVersion[] | null> {
  const email = await findEmail(teamId, sequenceId, emailId);
  if (!email) return null;
  // The live version is always listed: one published before version
  // history was kept is recorded now, so it can be restored later.
  const live = await getOrCreateContentVersion({ ...email, teamId });
  await markWasLive(db, live.id);
  const rows = await db
    .select()
    .from(emailContentVersions)
    .where(
      and(
        eq(emailContentVersions.sequenceEmailId, email.id),
        isNotNull(emailContentVersions.publishedAt),
      ),
    )
    .orderBy(
      // Live first, then the rest by when they went live.
      desc(eq(emailContentVersions.id, live.id)),
      desc(emailContentVersions.publishedAt),
    )
    .limit(VERSION_HISTORY_LIMIT);
  return rows.map((row) => ({
    versionId: row.versionId,
    subject: row.subject,
    content: row.content,
    publishedAt: row.publishedAt!,
    live: row.id === live.id,
  }));
}

/**
 * Loads an earlier published version (`versionId` from `listEmailVersions`)
 * into the email's draft, to be published like any other change. Restoring
 * the live version just discards the draft. Unless the broadcast or
 * sequence is active, it's restored directly.
 */
export async function restoreEmailVersion({
  teamId,
  sequenceId,
  emailId,
  versionId,
}: {
  teamId: string;
  sequenceId: string;
  emailId: string;
  versionId: string;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  const email = sequence?.emails.find((item) => item.emailId === emailId);
  if (!sequence || !email) return null;
  if (isBroadcastLocked(sequence)) throw new Error("mail_already_sent");
  const [version] = await db
    .select()
    .from(emailContentVersions)
    .where(
      and(
        eq(emailContentVersions.sequenceEmailId, email.id),
        eq(emailContentVersions.versionId, versionId),
        isNotNull(emailContentVersions.publishedAt),
      ),
    )
    .limit(1);
  if (!version) throw new Error("version_not_found");

  const restored = { subject: version.subject, content: version.content };
  await db.transaction(async (tx) => {
    // Unless it's active, edits are saved directly.
    await tx
      .update(sequenceEmails)
      .set({
        ...(editsAreDrafts(sequence)
          ? draftPatch(email, restored)
          : { ...restored, ...noDraft }),
        updatedAt: new Date(),
      })
      .where(eq(sequenceEmails.id, email.id));
    // A broadcast's title is its published subject: it follows a restore
    // saved directly, and a drafted one when that's published.
    if (
      sequence.type === "broadcast" &&
      !editsAreDrafts(sequence) &&
      sequence.title !== version.subject
    ) {
      await tx
        .update(sequences)
        .set({ title: version.subject, updatedAt: new Date() })
        .where(eq(sequences.id, sequence.id));
    }
  });
  await syncEmailContentMediaReferences({
    teamId,
    content: version.content as EmailContent,
    alsoReferenced: editsAreDrafts(sequence)
      ? (email.content as EmailContent)
      : undefined,
    resource: emailMediaResource(sequence, email),
  });

  captureEvent({
    event: "sequence_email_version_restored",
    source: "sequences.restore_version",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      email_id: email.emailId,
      version_id: version.versionId,
    },
  });
  return getSequenceBySequenceId(teamId, sequenceId);
}

async function findEmail(
  teamId: string,
  sequenceId: string,
  emailId: string,
): Promise<SequenceEmail | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  return sequence?.emails.find((email) => email.emailId === emailId) ?? null;
}
