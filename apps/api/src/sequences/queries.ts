import type { Email as EmailContent } from "@sendlit/email-editor";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { assertLargeBroadcastReviewed } from "../abuse/broadcast-review";
import { assertEmailContentAllowed } from "../abuse/content-scan";
import { assertNoImportUnderReview } from "../abuse/imports";
import { getMatchingContactIds } from "../automation/queries";
import {
  assertMarketingAllowedForContactUsage,
  assertSendAllowedForTeam,
  getOrganizationEntitlements,
  PlanGateError,
} from "../billing/entitlements";
import { nextPlanUp } from "../billing/policies";
import { usageForOrganization } from "../billing/usage";
import {
  type EmailActionType,
  EmailEventAction,
  EventType,
  itemsPerPage,
  type MailType,
  maxItemsPerPage,
  sequenceDelayBetweenMailsInMillis,
} from "../config/constants";
import { responses } from "../config/strings";
import {
  type ContactFilterWithAggregator,
  sequenceAudience,
} from "../contacts/segment";
import { db } from "../db/client";
import {
  contacts,
  emailContentVersions,
  emailDeliveries,
  emailEvents,
  espConfigs,
  ongoingSequences,
  sequenceEmails,
  sequences,
} from "../db/schema";
import {
  type DeliverySourceSelection,
  resolveDeliverySource,
} from "../delivery/queries";
import { syncEmailContentMediaReferences } from "../media/email-content";
import {
  deleteMediaReferencesForResource,
  deleteOrphanedMedia,
} from "../media/queries";
import { captureEvent } from "../observability";
import { assertMailingAddressConfigured } from "../settings/general/queries";
import { getTeam } from "../team/queries";
import { resolveStartingTemplate } from "../templates/queries";
import {
  broadcastArchiveBlocker,
  type SequenceDeleteBlocker,
  sequenceDeleteBlocker,
} from "./delete-blockers";
import {
  addRule,
  defaultEmailContent,
  removeRule,
  verifyMandatoryTags,
} from "./helpers";
import { TRIGGERS_NEEDING_DATA, validateTriggerState } from "./trigger";

export type Sequence = typeof sequences.$inferSelect;
export type SequenceEmail = typeof sequenceEmails.$inferSelect;
export type HydratedSequence = Sequence & {
  emails: SequenceEmail[];
  deliverySource: DeliverySourceSelection | null;
  entrantsCount?: number;
};

/** The report of a (re)started sequence: drops the deleted-delivery-source
 * marker and the auto-pause state (#25) along with its failure streak. */
function clearDeletedDeliverySourceMarker(report: unknown): Record<string, unknown> {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return {};
  }
  const {
    deliverySourceDeleted: _deleted,
    autoPause: _autoPause,
    health: _health,
    ...rest
  } = report as Record<string, unknown>;
  return rest;
}

async function hydrate(sequence: Sequence): Promise<HydratedSequence> {
  const emails = await db
    .select()
    .from(sequenceEmails)
    .where(eq(sequenceEmails.sequenceId, sequence.id))
    .orderBy(asc(sequenceEmails.createdAt));
  let deliverySource =
    (sequence.deliverySourceIntent as DeliverySourceSelection | null) ??
    (sequence.deliverySourceType
      ? { type: sequence.deliverySourceType as "organization" | "team" }
      : null);

  // A started team-delivery sequence is pinned to an exact ESP. Return its
  // public ID so read-only campaign views name the sender that actually
  // delivered the mail rather than the draft-only "team default" alias.
  if (
    !sequence.deliverySourceIntent &&
    sequence.deliverySourceType === "team" &&
    sequence.outboxId
  ) {
    const [esp] = await db
      .select({ espId: espConfigs.espId })
      .from(espConfigs)
      .where(eq(espConfigs.id, sequence.outboxId))
      .limit(1);
    if (esp) deliverySource = { type: "team", espId: esp.espId };
  }
  return { ...sequence, emails, deliverySource };
}

export async function createSequence({
  teamId,
  type,
  templateId,
  deliverySource,
}: {
  teamId: string;
  type: MailType;
  templateId: string;
  deliverySource?: DeliverySourceSelection;
}): Promise<HydratedSequence> {
  const template = await resolveStartingTemplate(teamId, templateId, "marketing");
  if (!template) {
    throw new Error(responses.item_not_found);
  }

  const [sequence] = await db
    .insert(sequences)
    .values({
      teamId,
      type,
      title: template.title || "Untitled",
      triggerType:
        type === "broadcast" ? EventType.DATE_OCCURRED : EventType.SUBSCRIBER_ADDED,
      filter: { aggregator: "or", filters: [] },
      deliverySourceIntent: deliverySource ?? null,
      // Sequences are lifecycle mail (onboarding, trials) that rarely
      // belongs on the web; broadcasts are editions readers revisit.
      viewInBrowser: type === "broadcast",
    })
    .returning();

  const content = (template.content as EmailContent) || defaultEmailContent;

  const [email] = await db
    .insert(sequenceEmails)
    .values({
      sequenceId: sequence.id,
      content: content as any,
      subject: type === "broadcast" ? sequence.title : template.title || "New email",
      delayInMillis: 0,
      // Broadcasts always send their single email, so it's published
      // by definition; drip/automation emails start unpublished.
      published: type === "broadcast",
    })
    .returning();

  const reconciledContent = await syncEmailContentMediaReferences({
    teamId,
    content,
    resource: {
      resourceType: "SEQUENCE_EMAIL",
      resourceInternalId: email.id,
      resourcePublicId: email.emailId,
      parentResourceInternalId: sequence.id,
      parentResourcePublicId: sequence.sequenceId,
    },
  });
  if (reconciledContent) {
    await db
      .update(sequenceEmails)
      .set({ content: reconciledContent as any, updatedAt: new Date() })
      .where(eq(sequenceEmails.id, email.id));
  }

  const [updated] = await db
    .update(sequences)
    .set({ emailsOrder: [email.emailId] })
    .where(eq(sequences.id, sequence.id))
    .returning();

  captureEvent({
    event: "sequence_created",
    source: "sequences.create",
    teamId,
    properties: {
      sequence_id: updated.sequenceId,
      sequence_type: updated.type,
      template_id: templateId,
    },
  });

  return hydrate(updated);
}

/** Looks up a single `sequence_emails` row by its parent's **internal**
 * `sequences.id` and its own public `emailId` — used by the tracking pixel/
 * click-redirect handlers, which only have public ids from the decoded JWT
 * but need the row's internal `id` to write an `email_deliveries`/`email_events`
 * FK. */
export async function getSequenceEmailByEmailId(
  sequenceId: string,
  emailId: string,
): Promise<SequenceEmail | null> {
  const [row] = await db
    .select()
    .from(sequenceEmails)
    .where(
      and(
        eq(sequenceEmails.sequenceId, sequenceId),
        eq(sequenceEmails.emailId, emailId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getSequenceBySequenceId(
  teamId: string,
  sequenceId: string,
): Promise<HydratedSequence | null> {
  const [row] = await db
    .select()
    .from(sequences)
    .where(and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)))
    .limit(1);
  if (!row) return null;
  return hydrate(row);
}

/** Which broadcasts a list shows: archived ones are hidden by default. */
export type ArchivedFilter = "exclude" | "only" | "include";

function listCondition(teamId: string, type: MailType, archived: ArchivedFilter) {
  const conditions: SQL[] = [eq(sequences.teamId, teamId), eq(sequences.type, type)];
  if (archived === "exclude") conditions.push(isNull(sequences.archivedAt));
  if (archived === "only") conditions.push(isNotNull(sequences.archivedAt));
  return and(...conditions);
}

export async function listSequences({
  teamId,
  type,
  offset = 1,
  itemsPerPage: perPage = itemsPerPage,
  archived = "exclude",
}: {
  teamId: string;
  type: MailType;
  offset?: number;
  itemsPerPage?: number;
  archived?: ArchivedFilter;
}): Promise<HydratedSequence[]> {
  const pageSize = Math.min(Math.max(perPage, 1), maxItemsPerPage);
  const rows = await db
    .select()
    .from(sequences)
    .where(listCondition(teamId, type, archived))
    .limit(pageSize)
    .offset((Math.max(offset, 1) - 1) * pageSize);
  if (rows.length === 0) return [];

  const activeEntrants = await db
    .select({ sequenceId: ongoingSequences.sequenceId, value: count() })
    .from(ongoingSequences)
    .where(
      inArray(
        ongoingSequences.sequenceId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(ongoingSequences.sequenceId);
  const activeEntrantsBySequenceId = new Map(
    activeEntrants.map((row) => [row.sequenceId, row.value]),
  );

  return Promise.all(
    rows.map(async (row) => ({
      ...(await hydrate(row)),
      entrantsCount:
        row.type === "broadcast"
          ? row.entrants.length
          : (activeEntrantsBySequenceId.get(row.id) ?? 0),
    })),
  );
}

export async function countSequences(
  teamId: string,
  type: MailType,
  archived: ArchivedFilter = "exclude",
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sequences)
    .where(listCondition(teamId, type, archived));
  return row?.value ?? 0;
}

export async function updateSequence({
  teamId,
  sequenceId,
  title,
  triggerType,
  triggerData,
  triggerFilter,
  reentry,
  reentryPeriodDays,
  filter,
  excludeFilter,
  emailsOrder,
  deliverySource,
  viewInBrowser,
}: {
  teamId: string;
  sequenceId: string;
  title?: string;
  triggerType?: string;
  triggerData?: string;
  /** `null` clears it. */
  triggerFilter?: unknown;
  reentry?: string;
  reentryPeriodDays?: number | null;
  filter?: ContactFilterWithAggregator;
  /** `null` clears the exclusion. */
  excludeFilter?: ContactFilterWithAggregator | null;
  emailsOrder?: string[];
  deliverySource?: DeliverySourceSelection | null;
  viewInBrowser?: boolean;
}): Promise<HydratedSequence | null> {
  const current = await getSequenceBySequenceId(teamId, sequenceId);
  if (!current) return null;
  // A sent broadcast's title is its email's subject, which can't change
  // after it went out (its content can't either; see updateMailInSequence).
  if (title !== undefined && title !== current.title && isBroadcastLocked(current)) {
    throw new Error(responses.mail_already_sent);
  }
  const patch: Partial<Sequence> = { updatedAt: new Date() };
  if (title !== undefined) patch.title = title;
  const triggerChanged =
    triggerType !== undefined ||
    triggerData !== undefined ||
    triggerFilter !== undefined ||
    reentry !== undefined ||
    reentryPeriodDays !== undefined;
  if (triggerChanged) {
    if (
      current.type === "broadcast" &&
      (reentry !== undefined || reentryPeriodDays != null)
    ) {
      throw new Error("invalid_reentry");
    }
    const typeChanged =
      triggerType !== undefined && triggerType !== current.triggerType;
    const trigger = validateTriggerState({
      type: current.type,
      triggerType: triggerType ?? current.triggerType,
      triggerData: triggerData !== undefined ? triggerData : current.triggerData,
      // Changing the trigger type drops a filter written for the old one.
      triggerFilter:
        triggerFilter !== undefined
          ? triggerFilter
          : typeChanged
            ? null
            : current.triggerFilter,
      reentry: reentry ?? current.reentry,
      reentryPeriodDays:
        reentryPeriodDays !== undefined ? reentryPeriodDays : current.reentryPeriodDays,
    });
    patch.triggerType = trigger.triggerType;
    patch.triggerData = trigger.triggerData;
    patch.triggerFilter = trigger.triggerFilter as any;
    patch.reentry = trigger.reentry;
    patch.reentryPeriodDays = trigger.reentryPeriodDays;
  }
  if (filter !== undefined) patch.filter = filter as any;
  if (excludeFilter !== undefined) {
    patch.excludeFilter = excludeFilter?.filters.length ? (excludeFilter as any) : null;
  }
  if (emailsOrder !== undefined) patch.emailsOrder = emailsOrder;
  // Allowed at any time, even after a broadcast went out: turning it off is
  // how a team takes down web versions already linked from sent mail.
  if (viewInBrowser !== undefined) patch.viewInBrowser = viewInBrowser;
  if (deliverySource !== undefined) {
    if (!["draft", "paused"].includes(current.status)) {
      throw new Error("esp_cannot_change_after_start");
    }
    patch.deliverySourceIntent = deliverySource as any;
  }

  // An active sequence fires on its `rules` row, so a trigger edit has to
  // replace it in the same transaction, or the old trigger keeps firing
  // until the sequence is paused and resumed.
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sequences)
      .set(patch)
      .where(and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)))
      .returning();
    if (!updated) return null;
    if (
      updated.type === "sequence" &&
      updated.status === "active" &&
      (updated.triggerType !== current.triggerType ||
        updated.triggerData !== current.triggerData ||
        JSON.stringify(updated.triggerFilter) !== JSON.stringify(current.triggerFilter))
    ) {
      await removeRule({ teamId, sequenceId: updated.id }, tx);
      if (updated.triggerType) {
        await addRule(
          {
            teamId,
            sequenceId: updated.id,
            triggerType: updated.triggerType,
            triggerData: updated.triggerData,
            triggerFilter: updated.triggerFilter,
          },
          tx,
        );
      }
    }
    return updated;
  });
  if (!row) return null;

  // Broadcasts have a single email whose subject always mirrors the
  // broadcast's title, so the composer doesn't need a separate subject field.
  if (row.type === "broadcast" && title !== undefined) {
    const broadcastEmail = current.emails[0];
    if (broadcastEmail) {
      await db
        .update(sequenceEmails)
        .set({ subject: title, updatedAt: new Date() })
        .where(eq(sequenceEmails.id, broadcastEmail.id));
    }
  }

  captureEvent({
    event: "sequence_updated",
    source: "sequences.update",
    teamId,
    properties: {
      sequence_id: row.sequenceId,
      sequence_type: row.type,
      sequence_status: row.status,
    },
  });
  return hydrate(row);
}

export async function addMailToSequence({
  teamId,
  sequenceId,
  templateId,
}: {
  teamId: string;
  sequenceId: string;
  templateId: string;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  if (sequence.type === "broadcast") {
    throw new Error(responses.action_not_allowed);
  }

  const template = await resolveStartingTemplate(teamId, templateId, "marketing");
  if (!template) {
    throw new Error(responses.item_not_found);
  }

  const content = (template.content as EmailContent) || defaultEmailContent;

  const [email] = await db
    .insert(sequenceEmails)
    .values({
      sequenceId: sequence.id,
      content: content as any,
      subject: template.title || "New email",
      delayInMillis: sequenceDelayBetweenMailsInMillis,
    })
    .returning();

  const reconciledContent = await syncEmailContentMediaReferences({
    teamId,
    content,
    resource: {
      resourceType: "SEQUENCE_EMAIL",
      resourceInternalId: email.id,
      resourcePublicId: email.emailId,
      parentResourceInternalId: sequence.id,
      parentResourcePublicId: sequence.sequenceId,
    },
  });
  if (reconciledContent) {
    await db
      .update(sequenceEmails)
      .set({ content: reconciledContent as any, updatedAt: new Date() })
      .where(eq(sequenceEmails.id, email.id));
  }

  const [row] = await db
    .update(sequences)
    .set({ emailsOrder: [...sequence.emailsOrder, email.emailId] })
    .where(eq(sequences.id, sequence.id))
    .returning();

  captureEvent({
    event: "sequence_email_added",
    source: "sequences.add_mail",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      email_id: email.emailId,
      template_id: templateId,
    },
  });

  return hydrate(row);
}

function isBroadcastLocked(sequence: HydratedSequence): boolean {
  const report = (sequence.report || {}) as any;
  return (
    sequence.type === "broadcast" &&
    ["active", "completed"].includes(sequence.status) &&
    Boolean(report?.broadcast?.lockedAt)
  );
}

export async function updateMailInSequence({
  teamId,
  sequenceId,
  emailId,
  subject,
  content,
  delayInMillis,
  templateId,
  actionType,
  actionData,
  published,
}: {
  teamId: string;
  sequenceId: string;
  emailId: string;
  subject?: string;
  content?: unknown;
  delayInMillis?: number;
  templateId?: string;
  actionType?: EmailActionType;
  actionData?: Record<string, unknown>;
  published?: boolean;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  if (isBroadcastLocked(sequence)) return sequence;

  const email = sequence.emails.find((e) => e.emailId === emailId);
  if (!email) throw new Error(responses.item_not_found);

  if (templateId !== undefined) {
    const template = await resolveStartingTemplate(teamId, templateId, "marketing");
    if (!template) throw new Error(responses.item_not_found);
  }

  if (content) {
    verifyMandatoryTags((content as any).content || []);
    content =
      (await syncEmailContentMediaReferences({
        teamId,
        content: content as EmailContent,
        resource: {
          resourceType: "SEQUENCE_EMAIL",
          resourceInternalId: email.id,
          resourcePublicId: email.emailId,
          parentResourceInternalId: sequence.id,
          parentResourcePublicId: sequence.sequenceId,
        },
      })) || content;
  }

  const patch: Partial<SequenceEmail> = { updatedAt: new Date() };
  // Broadcasts always mirror the sequence title as their subject and are
  // always published, so those fields aren't independently editable.
  if (sequence.type === "broadcast") {
    patch.subject = sequence.title;
    patch.published = true;
  } else {
    if (subject !== undefined) patch.subject = subject;
    if (published !== undefined) patch.published = published;
  }
  if (content !== undefined) patch.content = content as any;
  // A running sequence sends edits straight away, so they're scanned now.
  if (sequence.status === "active" && (patch.content || patch.subject)) {
    await assertEmailContentAllowed({
      teamId,
      email,
      subject: patch.subject ?? email.subject,
      content: patch.content ?? email.content,
    });
  }
  if (delayInMillis !== undefined) patch.delayInMillis = delayInMillis;
  if (templateId !== undefined) patch.templateId = templateId;
  if (actionType !== undefined) patch.actionType = actionType;
  if (actionData !== undefined) patch.actionData = actionData as any;

  await db
    .update(sequenceEmails)
    .set(patch)
    .where(
      and(
        eq(sequenceEmails.sequenceId, sequence.id),
        eq(sequenceEmails.emailId, emailId),
      ),
    );

  captureEvent({
    event: "sequence_email_updated",
    source: "sequences.update_mail",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      email_id: email.emailId,
      action_type: actionType,
      template_id: templateId,
    },
  });

  return getSequenceBySequenceId(teamId, sequenceId);
}

/**
 * The ids of the given sequence emails that were already sent: they have a
 * delivery or a stored content version.
 */
async function sentEmailIds(emailIds: string[]): Promise<Set<string>> {
  if (!emailIds.length) return new Set();
  const [delivered, versioned] = await Promise.all([
    db
      .selectDistinct({ id: emailDeliveries.emailId })
      .from(emailDeliveries)
      .where(inArray(emailDeliveries.emailId, emailIds)),
    db
      .selectDistinct({ id: emailContentVersions.sequenceEmailId })
      .from(emailContentVersions)
      .where(inArray(emailContentVersions.sequenceEmailId, emailIds)),
  ]);
  return new Set([...delivered, ...versioned].map((row) => row.id));
}

/**
 * Removes the media references of sequence emails about to be deleted and
 * returns the media rows to pass to `deleteOrphanedMedia` after the delete.
 * Media of an email that was already sent (`sentIds`) is left out: inboxes
 * and "view in browser" pages load its images by URL, so it stays in the
 * media library until the user deletes it there. Pass `sentIds` when the
 * deliveries that prove it are gone by now.
 */
async function releaseEmailMedia(
  teamId: string,
  emailIds: string[],
  sentIds?: Set<string>,
): Promise<string[]> {
  if (!emailIds.length) return [];
  const sent = sentIds ?? (await sentEmailIds(emailIds));
  const draftIds = emailIds.filter((id) => !sent.has(id));

  const kept = new Set(
    await deleteMediaReferencesForResource({
      teamId,
      resourceType: "SEQUENCE_EMAIL",
      resourceInternalId: emailIds.filter((id) => sent.has(id)),
    }),
  );
  const released = await deleteMediaReferencesForResource({
    teamId,
    resourceType: "SEQUENCE_EMAIL",
    resourceInternalId: draftIds,
  });
  return released.filter((id) => !kept.has(id));
}

export async function deleteMailFromSequence({
  teamId,
  sequenceId,
  emailId,
}: {
  teamId: string;
  sequenceId: string;
  emailId: string;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  if (sequence.type === "broadcast") {
    throw new Error(responses.action_not_allowed);
  }
  if (sequence.emails.length === 1) {
    throw new Error(responses.cannot_delete_last_email);
  }

  const email = sequence.emails.find((item) => item.emailId === emailId);
  const mediaIds = email ? await releaseEmailMedia(teamId, [email.id]) : [];

  await db
    .delete(sequenceEmails)
    .where(
      and(
        eq(sequenceEmails.sequenceId, sequence.id),
        eq(sequenceEmails.emailId, emailId),
      ),
    );

  await db
    .update(sequences)
    .set({
      emailsOrder: sequence.emailsOrder.filter((id) => id !== emailId),
    })
    .where(eq(sequences.id, sequence.id));
  const media = await deleteOrphanedMedia(teamId, mediaIds);

  captureEvent({
    event: "sequence_email_deleted",
    source: "sequences.delete_mail",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
      email_id: emailId,
      media_deleted_count: media.deleted,
    },
  });

  return getSequenceBySequenceId(teamId, sequenceId);
}

export interface SequenceDeletionImpact {
  status: string;
  /** Why it can't be deleted now, or null when it can. */
  blocker: SequenceDeleteBlocker | null;
  /** Contacts currently moving through it; they stop receiving it. */
  enrolledCount: number;
  /** Emails it has sent; their delivery and open/click history is deleted. */
  emailsSentCount: number;
}

function deleteBlockerOf(sequence: HydratedSequence) {
  return sequenceDeleteBlocker({
    status: sequence.status,
    type: sequence.type,
    report: sequence.report,
    sendAt: sequence.emails[0]?.delayInMillis,
  });
}

/**
 * Rows that may be deleted right now, repeated in the delete statement so a
 * sequence started (or a broadcast that began sending) since the check is
 * kept: not active, except a broadcast still waiting for its send time;
 * and never a broadcast that has started sending.
 */
const deletableNow = () => {
  const notStarted = sql`${sequences.report}->'broadcast'->>'lockedAt' IS NULL`;
  return or(
    and(eq(sequences.type, "sequence"), sql`${sequences.status} <> 'active'`),
    and(eq(sequences.type, "broadcast"), notStarted),
  );
};

/** What deleting a sequence would remove, shown before the user confirms. */
export async function getSequenceDeletionImpact(
  teamId: string,
  sequenceId: string,
): Promise<SequenceDeletionImpact | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return null;
  const [[enrolled], [sent]] = await Promise.all([
    db
      .select({ value: count() })
      .from(ongoingSequences)
      .where(eq(ongoingSequences.sequenceId, sequence.id)),
    db
      .select({ value: count() })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sequenceId, sequence.id)),
  ]);
  return {
    status: sequence.status,
    blocker: deleteBlockerOf(sequence),
    enrolledCount: enrolled?.value ?? 0,
    emailsSentCount: sent?.value ?? 0,
  };
}

/**
 * Permanently deletes a broadcast or sequence that isn't active (see ADR
 * 0007). Contacts still enrolled in a paused sequence leave it, and its
 * delivery and open/click history goes with it; the outbound message log
 * and suppressions are kept. Throws a `SequenceDeleteBlocker` code when it
 * can't be deleted; returns false when it doesn't exist.
 */
export async function deleteSequence({
  teamId,
  sequenceId,
}: {
  teamId: string;
  sequenceId: string;
}): Promise<boolean> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) return false;
  const blocker = deleteBlockerOf(sequence);
  if (blocker) throw new Error(blocker);

  const impact = await getSequenceDeletionImpact(teamId, sequenceId);
  const emailIds = sequence.emails.map((email) => email.id);
  // Read before the delete: the deliveries that mark an email as sent
  // cascade away with the sequence.
  const sentIds = await sentEmailIds(emailIds);

  // Guarded on status so a sequence started since the read above is kept.
  const removed = await db
    .delete(sequences)
    .where(and(eq(sequences.id, sequence.id), deletableNow()))
    .returning({ id: sequences.id });
  if (!removed.length) {
    const current = await getSequenceBySequenceId(teamId, sequenceId);
    if (!current) return false;
    throw new Error(deleteBlockerOf(current) ?? "sequence_active");
  }

  const mediaIds = await releaseEmailMedia(teamId, emailIds, sentIds);
  const media = await deleteOrphanedMedia(teamId, mediaIds);

  captureEvent({
    event: "sequence_deleted",
    source: "sequences.delete",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      media_deleted_count: media.deleted,
      sequence_type: sequence.type,
      sequence_status: sequence.status,
      enrolled_count: impact?.enrolledCount ?? 0,
      emails_sent_count: impact?.emailsSentCount ?? 0,
    },
  });

  return true;
}

/**
 * Archives (or, with `archived: false`, restores) a sent broadcast (#147).
 * An archived broadcast is hidden from the default list and the public web
 * archive; its report, delivery history and images are kept. Throws
 * `broadcast_not_sent` for a draft or scheduled broadcast (delete it
 * instead) and `sequence_active` while it is sending; returns null when
 * there is no such broadcast.
 */
export async function setBroadcastArchived({
  teamId,
  sequenceId,
  archived,
}: {
  teamId: string;
  sequenceId: string;
  archived: boolean;
}): Promise<HydratedSequence | null> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (sequence?.type !== "broadcast") return null;
  if (archived) {
    const blocker = broadcastArchiveBlocker({
      status: sequence.status,
      type: sequence.type,
      report: sequence.report,
      sendAt: sequence.emails[0]?.delayInMillis,
    });
    if (blocker) throw new Error(blocker);
  }
  if (Boolean(sequence.archivedAt) === archived) return sequence;

  const [row] = await db
    .update(sequences)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(sequences.id, sequence.id))
    .returning();

  captureEvent({
    event: archived ? "broadcast_archived" : "broadcast_unarchived",
    source: archived ? "sequences.archive" : "sequences.unarchive",
    teamId,
    properties: { sequence_id: sequence.sequenceId, sequence_status: sequence.status },
  });

  return hydrate(row);
}

export async function startSequence({
  teamId,
  sequenceId,
}: {
  teamId: string;
  sequenceId: string;
}): Promise<HydratedSequence> {
  await assertMailingAddressConfigured(teamId);

  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) throw new Error(responses.item_not_found);

  if (!["draft", "paused"].includes(sequence.status)) {
    throw new Error(responses.sequence_already_started);
  }
  // An archived broadcast was paused mid-send; restore it before resuming.
  if (sequence.archivedAt) throw new Error(responses.broadcast_archived);
  if (!sequence.emails.some((e) => e.published)) {
    throw new Error(responses.no_published_emails);
  }

  await assertSendAllowedForTeam(teamId, "marketing");
  const team = await getTeam(teamId);
  if (!team) throw new Error("team_not_found");
  // Hosted abuse controls: a new account's large import waits for review,
  // and every published email is scanned before anything goes out.
  await assertNoImportUnderReview(team.organizationId);
  for (const email of sequence.emails.filter((e) => e.published)) {
    await assertEmailContentAllowed({ teamId, email });
  }

  // A broadcast paused mid-send (automatically, #25) resumes its queued
  // deliveries; running its audience again would email people twice.
  if (
    sequence.type === "broadcast" &&
    sequence.status === "paused" &&
    (sequence.report as { broadcast?: { lockedAt?: number | null } } | null)?.broadcast
      ?.lockedAt
  ) {
    const [resumed] = await db
      .update(sequences)
      .set({
        status: "active",
        report: {
          ...clearDeletedDeliverySourceMarker(sequence.report),
          healthSince: Date.now(),
        },
        updatedAt: new Date(),
      })
      .where(eq(sequences.id, sequence.id))
      .returning();
    captureEvent({
      event: "sequence_resumed",
      source: "sequences.start",
      teamId,
      properties: { sequence_id: sequence.sequenceId, sequence_type: sequence.type },
    });
    return hydrate(resumed);
  }
  await db.transaction(async (tx) => {
    await assertMarketingAllowedForContactUsage(tx, team.organizationId);
  });

  const pin = await resolveDeliverySource(
    teamId,
    (sequence.deliverySourceIntent as DeliverySourceSelection | null) ?? undefined,
    "marketing",
  );

  if (sequence.type === "sequence") {
    // Sender identity is no longer stored per-sequence — the send path
    // always resolves one (sequence outbox -> team esp config -> team
    // name/owner email), so only title/trigger completeness is checked.
    if (!sequence.title || !sequence.triggerType) {
      throw new Error(`${responses.sequence_details_missing}: basics`);
    }
    if (TRIGGERS_NEEDING_DATA.includes(sequence.triggerType) && !sequence.triggerData) {
      throw new Error(`${responses.sequence_details_missing}: trigger`);
    }
  }

  // Broadcasts don't require a filter: an empty/null filter means the
  // whole audience (buildContactFilterCondition returns no condition).
  // Refuse to start a broadcast that currently matches nobody — otherwise
  // the schedule would fire, lock an empty snapshot, and (without the
  // empty-audience completion path) look stuck in "sending". Multi-step
  // sequences are allowed with an empty list; they enroll later via triggers.
  if (sequence.type === "broadcast") {
    const recipientIds = await getMatchingContactIds(
      teamId,
      sequenceAudience(sequence),
    );
    if (recipientIds.length === 0) {
      throw new Error(responses.broadcast_no_recipients);
    }
    await assertLargeBroadcastReviewed({
      organizationId: team.organizationId,
      teamId,
      deliverySourceType: pin.type,
      sequence,
      recipients: recipientIds.length,
    });
    const entitlements = await getOrganizationEntitlements(team.organizationId);
    if (entitlements.monthlySendsLimit !== null) {
      const usage = await usageForOrganization(team.organizationId);
      const projected =
        usage.monthlySends + usage.monthlySendsReserved + recipientIds.length;
      if (projected > entitlements.monthlySendsLimit) {
        throw new PlanGateError("plan_limit_reached", {
          organizationId: team.organizationId,
          capability: "monthly_sends",
          limit: entitlements.monthlySendsLimit,
          usage: usage.monthlySends + usage.monthlySendsReserved,
          plan: entitlements.plan,
          requiredPlan: nextPlanUp(entitlements.plan),
        });
      }
    }
  }

  const pinChanged =
    sequence.deliverySourceType !== pin.type ||
    sequence.outboxId !== pin.espConfigId ||
    sequence.espGrantId !== pin.espGrantId;
  if (sequence.status === "paused" && sequence.deliverySourceType && pinChanged) {
    // PostgreSQL correctly keeps pins immutable. A paused sequence is the
    // one safe exception: clear the old pin first, then assign the newly
    // resolved source below.
    await db
      .update(sequences)
      .set({
        deliverySourceType: null,
        outboxId: null,
        espGrantId: null,
        updatedAt: new Date(),
      })
      .where(eq(sequences.id, sequence.id));
  }

  await addRule({
    teamId,
    sequenceId: sequence.id,
    triggerType: sequence.triggerType!,
    triggerData: sequence.triggerData,
    triggerFilter: sequence.triggerFilter,
    eventDateInMillis:
      sequence.type === "broadcast" ? sequence.emails[0].delayInMillis : undefined,
  });

  const [row] = await db
    .update(sequences)
    .set({
      status: "active",
      deliverySourceType: pin.type,
      outboxId: pin.espConfigId,
      espGrantId: pin.espGrantId,
      report: {
        ...clearDeletedDeliverySourceMarker(sequence.report),
        // A restarted sequence's bounce/complaint rates start over (#25).
        ...(sequence.status === "paused" && { healthSince: Date.now() }),
      },
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, sequence.id))
    .returning();

  captureEvent({
    event: "sequence_started",
    source: "sequences.start",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
    },
  });

  return hydrate(row);
}

export async function pauseSequence({
  teamId,
  sequenceId,
}: {
  teamId: string;
  sequenceId: string;
}): Promise<HydratedSequence> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) throw new Error(responses.item_not_found);
  if (sequence.status !== "active") {
    throw new Error(responses.sequence_not_active);
  }

  const report = (sequence.report || {}) as any;
  if (
    sequence.type === "broadcast" &&
    (report?.broadcast?.lockedAt || sequence.emails[0].delayInMillis <= Date.now())
  ) {
    throw new Error(responses.mail_already_sent);
  }

  await removeRule({ teamId, sequenceId: sequence.id });

  const [row] = await db
    .update(sequences)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(sequences.id, sequence.id))
    .returning();

  captureEvent({
    event: "sequence_paused",
    source: "sequences.pause",
    teamId,
    properties: {
      sequence_id: sequence.sequenceId,
      sequence_type: sequence.type,
    },
  });

  return hydrate(row);
}

/** All of these take the **public** `sequenceId` (unchanged external
 * signature for their route/mcp-tool callers) and resolve to the internal id
 * via a join through `sequences`, since `email_deliveries`/`email_events` now
 * store internal-id FKs. */

export async function getEmailSentCount(sequenceId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emailDeliveries)
    .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
    .where(eq(sequences.sequenceId, sequenceId));
  return row?.value ?? 0;
}

export async function getSubscribers({
  sequenceId,
  page = 1,
  limit = itemsPerPage,
}: {
  sequenceId: string;
  page?: number;
  limit?: number;
}): Promise<string[]> {
  const rows = await db
    .selectDistinct({ contactId: contacts.contactId })
    .from(emailDeliveries)
    .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
    .innerJoin(contacts, eq(contacts.id, emailDeliveries.contactId))
    .where(eq(sequences.sequenceId, sequenceId))
    .limit(limit)
    .offset((Math.max(page, 1) - 1) * limit);
  return rows.map((r) => r.contactId);
}

export async function getSubscribersCount(sequenceId: string): Promise<number> {
  const rows = await db
    .selectDistinct({ contactId: emailDeliveries.contactId })
    .from(emailDeliveries)
    .innerJoin(sequences, eq(sequences.id, emailDeliveries.sequenceId))
    .where(eq(sequences.sequenceId, sequenceId));
  return rows.length;
}

async function countDistinctContactsWithEvent(
  sequenceId: string,
  action: string,
): Promise<number> {
  const rows = await db
    .selectDistinct({ contactId: emailEvents.contactId })
    .from(emailEvents)
    .innerJoin(sequences, eq(sequences.id, emailEvents.sequenceId))
    .where(and(eq(sequences.sequenceId, sequenceId), eq(emailEvents.action, action)));
  return rows.length;
}

export async function getSequenceOpenRate(sequenceId: string): Promise<number> {
  const recipients = await getSubscribersCount(sequenceId);
  if (!recipients) return 0;
  const openers = await countDistinctContactsWithEvent(
    sequenceId,
    EmailEventAction.OPEN,
  );
  return openers / recipients;
}

export async function getSequenceClickThroughRate(sequenceId: string): Promise<number> {
  const recipients = await getSubscribersCount(sequenceId);
  if (!recipients) return 0;
  const clickers = await countDistinctContactsWithEvent(
    sequenceId,
    EmailEventAction.CLICK,
  );
  return clickers / recipients;
}
