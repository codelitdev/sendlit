import { and, eq } from "drizzle-orm";
import { contentHash } from "../abuse/content-scan";
import { db } from "../db/client";
import { emailContentVersions, type sequenceEmails } from "../db/schema";

export type EmailContentVersion = typeof emailContentVersions.$inferSelect;

/** `id` is internal (for `email_deliveries`); `versionId` is public (for
 * links). */
export type ContentVersionRef = Pick<EmailContentVersion, "id" | "versionId">;

// A broadcast sends the same content to every recipient, so the version is
// remembered per content instead of looked up for each one.
const knownVersions = new Map<string, ContentVersionRef>();
const KNOWN_VERSIONS_MAX = 1000;

/**
 * The stored copy of `email`'s current subject and content, created the
 * first time this content is sent. Sends put its public `versionId` in their
 * "view in browser" link so the page shows what was sent, not later edits.
 */
export async function getOrCreateContentVersion(
  email: Pick<typeof sequenceEmails.$inferSelect, "id" | "subject" | "content"> & {
    teamId: string;
  },
): Promise<ContentVersionRef> {
  const hash = contentHash(email.subject, email.content);
  const key = `${email.id}:${hash}`;
  const known = knownVersions.get(key);
  if (known) return known;

  const [inserted] = await db
    .insert(emailContentVersions)
    .values({
      teamId: email.teamId,
      sequenceEmailId: email.id,
      contentHash: hash,
      subject: email.subject,
      content: email.content,
    })
    .onConflictDoNothing()
    .returning({
      id: emailContentVersions.id,
      versionId: emailContentVersions.versionId,
    });
  const version =
    inserted ??
    (
      await db
        .select({
          id: emailContentVersions.id,
          versionId: emailContentVersions.versionId,
        })
        .from(emailContentVersions)
        .where(
          and(
            eq(emailContentVersions.sequenceEmailId, email.id),
            eq(emailContentVersions.contentHash, hash),
          ),
        )
        .limit(1)
    )[0];
  if (!version) throw new Error("content_version_not_saved");

  if (knownVersions.size >= KNOWN_VERSIONS_MAX) knownVersions.clear();
  knownVersions.set(key, version);
  return version;
}

/** The stored version with public id `versionId`, or null when it isn't a
 * version of the email whose internal id is `sequenceEmailId`. */
export async function getContentVersion(
  sequenceEmailId: string,
  versionId: string,
): Promise<EmailContentVersion | null> {
  const [row] = await db
    .select()
    .from(emailContentVersions)
    .where(
      and(
        eq(emailContentVersions.versionId, versionId),
        eq(emailContentVersions.sequenceEmailId, sequenceEmailId),
      ),
    )
    .limit(1);
  return row ?? null;
}
