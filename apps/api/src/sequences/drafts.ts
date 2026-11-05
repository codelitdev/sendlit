import { contentHash } from "../abuse/content-hash";
import type { sequenceEmails, sequences } from "../db/schema";
import { omitInternal } from "../utils/public";

/**
 * Draft and publish for broadcast and sequence emails (#184, ADR 0011).
 *
 * `sequence_emails.subject` and `content` are the published version: every
 * send renders from them (or from a version pinned for the contact, see
 * `ongoing_sequences.pinned_versions`). While a broadcast or sequence is
 * active, edits to subject and content are saved as a draft in
 * `draft_subject` and `draft_content` and only go live when they're
 * published. Otherwise nothing is sending, so edits are saved directly (a
 * paused broadcast is rescheduled, and a paused sequence is rescanned, by
 * `startSequence`).
 */

type EmailRow = typeof sequenceEmails.$inferSelect;

/** Whether edits to this sequence's emails are saved as drafts. */
export function editsAreDrafts(
  sequence: Pick<typeof sequences.$inferSelect, "status">,
) {
  return sequence.status === "active";
}

export function hasDraft(
  email: Pick<EmailRow, "draftSubject" | "draftContent">,
): email is Pick<EmailRow, "draftSubject" | "draftContent"> & {
  draftSubject: string;
  draftContent: unknown;
} {
  return email.draftSubject != null && email.draftContent != null;
}

/** The subject and content the editor works on: the draft when there is
 * one, otherwise the published version. */
export function workingCopy(
  email: Pick<EmailRow, "subject" | "content" | "draftSubject" | "draftContent">,
): { subject: string; content: unknown } {
  return hasDraft(email)
    ? { subject: email.draftSubject, content: email.draftContent }
    : { subject: email.subject, content: email.content };
}

/**
 * The columns to write when `subject` and/or `content` are saved as a
 * draft. Starts from the current working copy, so saving only the content
 * keeps a drafted subject. A draft equal to the published version is
 * dropped, so "unpublished changes" means the two really differ.
 */
export function draftPatch(
  email: Pick<EmailRow, "subject" | "content" | "draftSubject" | "draftContent">,
  edit: { subject?: string; content?: unknown },
): Pick<EmailRow, "draftSubject" | "draftContent" | "draftUpdatedAt"> {
  const current = workingCopy(email);
  const subject = edit.subject ?? current.subject;
  const content = edit.content ?? current.content;
  if (contentHash(subject, content) === contentHash(email.subject, email.content)) {
    return { draftSubject: null, draftContent: null, draftUpdatedAt: null };
  }
  return { draftSubject: subject, draftContent: content, draftUpdatedAt: new Date() };
}

/** Clears the draft. */
export const noDraft: Pick<
  EmailRow,
  "draftSubject" | "draftContent" | "draftUpdatedAt"
> = Object.freeze({ draftSubject: null, draftContent: null, draftUpdatedAt: null });

/** An email as REST and MCP return it: internal columns dropped and the
 * draft, if any, as `draft`. */
export function toPublicSequenceEmail(email: EmailRow) {
  const draft = hasDraft(email)
    ? {
        subject: email.draftSubject,
        content: email.draftContent,
        updatedAt: email.draftUpdatedAt,
      }
    : null;
  return {
    ...omitInternal(email, [
      "sequenceId",
      "contentScanHash",
      "contentScanReasons",
      "draftSubject",
      "draftContent",
      "draftUpdatedAt",
    ]),
    draft,
    hasUnpublishedChanges: draft !== null,
  };
}

export function sequenceHasUnpublishedChanges(sequence: { emails: EmailRow[] }) {
  return sequence.emails.some(hasDraft);
}
