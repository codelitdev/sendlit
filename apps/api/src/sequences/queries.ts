import { and, eq, count, asc } from "drizzle-orm";
import { db } from "../db/client";
import {
  sequences,
  sequenceEmails,
  emailDeliveries,
  emailEvents,
} from "../db/schema";
import { generateUniqueId } from "../utils/id";
import { resolveStartingTemplate } from "../templates/queries";
import {
  addRule,
  defaultEmailContent,
  removeRule,
  verifyMandatoryTags,
} from "./helpers";
import {
  EmailActionType,
  EmailEventAction,
  EventType,
  MailType,
  itemsPerPage,
  sequenceDelayBetweenMailsInMillis,
} from "../config/constants";
import { responses } from "../config/strings";
import type { ContactFilterWithAggregator } from "../contacts/segment";

export type Sequence = typeof sequences.$inferSelect;
export type SequenceEmail = typeof sequenceEmails.$inferSelect;
export type HydratedSequence = Sequence & { emails: SequenceEmail[] };

async function hydrate(sequence: Sequence): Promise<HydratedSequence> {
  const emails = await db
    .select()
    .from(sequenceEmails)
    .where(eq(sequenceEmails.sequenceId, sequence.id))
    .orderBy(asc(sequenceEmails.createdAt));
  return { ...sequence, emails };
}

export async function createSequence({
  teamId,
  type,
  templateId,
}: {
  teamId: string;
  type: MailType;
  templateId: string;
}): Promise<HydratedSequence> {
  const template = await resolveStartingTemplate(teamId, templateId);
  if (!template) {
    throw new Error(responses.item_not_found);
  }

  const [sequence] = await db
    .insert(sequences)
    .values({
      teamId,
      sequenceId: generateUniqueId(),
      type,
      title: template.title || "Untitled",
      triggerType:
        type === "broadcast"
          ? EventType.DATE_OCCURRED
          : EventType.SUBSCRIBER_ADDED,
      filter: { aggregator: "or", filters: [] },
    })
    .returning();

  const [email] = await db
    .insert(sequenceEmails)
    .values({
      sequenceId: sequence.id,
      emailId: generateUniqueId(),
      content: (template.content as any) || defaultEmailContent,
      subject:
        template.title ||
        (type === "broadcast" ? "New broadcast" : "New email"),
      delayInMillis: 0,
      published: false,
    })
    .returning();

  const [updated] = await db
    .update(sequences)
    .set({ emailsOrder: [email.emailId] })
    .where(eq(sequences.id, sequence.id))
    .returning();

  return hydrate(updated);
}

export async function getSequenceBySequenceId(
  teamId: string,
  sequenceId: string,
): Promise<HydratedSequence | null> {
  const [row] = await db
    .select()
    .from(sequences)
    .where(
      and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)),
    )
    .limit(1);
  if (!row) return null;
  return hydrate(row);
}

export async function listSequences({
  teamId,
  type,
  offset = 1,
  itemsPerPage: perPage = itemsPerPage,
}: {
  teamId: string;
  type: MailType;
  offset?: number;
  itemsPerPage?: number;
}): Promise<HydratedSequence[]> {
  const rows = await db
    .select()
    .from(sequences)
    .where(and(eq(sequences.teamId, teamId), eq(sequences.type, type)))
    .limit(perPage)
    .offset((Math.max(offset, 1) - 1) * perPage);
  return Promise.all(rows.map(hydrate));
}

export async function countSequences(
  teamId: string,
  type: MailType,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sequences)
    .where(and(eq(sequences.teamId, teamId), eq(sequences.type, type)));
  return row?.value ?? 0;
}

export async function updateSequence({
  teamId,
  sequenceId,
  title,
  fromName,
  fromEmail,
  triggerType,
  triggerData,
  filter,
  emailsOrder,
}: {
  teamId: string;
  sequenceId: string;
  title?: string;
  fromName?: string;
  fromEmail?: string;
  triggerType?: string;
  triggerData?: string;
  filter?: ContactFilterWithAggregator;
  emailsOrder?: string[];
}): Promise<HydratedSequence | null> {
  const patch: Partial<Sequence> = { updatedAt: new Date() };
  if (title !== undefined) patch.title = title;
  if (fromName !== undefined) patch.fromName = fromName;
  if (fromEmail !== undefined) patch.fromEmail = fromEmail;
  if (triggerType !== undefined) patch.triggerType = triggerType;
  if (triggerData !== undefined) patch.triggerData = triggerData;
  if (filter !== undefined) patch.filter = filter as any;
  if (emailsOrder !== undefined) patch.emailsOrder = emailsOrder;

  const [row] = await db
    .update(sequences)
    .set(patch)
    .where(
      and(eq(sequences.teamId, teamId), eq(sequences.sequenceId, sequenceId)),
    )
    .returning();
  if (!row) return null;
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

  const template = await resolveStartingTemplate(teamId, templateId);
  if (!template) {
    throw new Error(responses.item_not_found);
  }

  const [email] = await db
    .insert(sequenceEmails)
    .values({
      sequenceId: sequence.id,
      emailId: generateUniqueId(),
      content: (template.content as any) || defaultEmailContent,
      subject: template.title || "New email",
      delayInMillis: sequenceDelayBetweenMailsInMillis,
    })
    .returning();

  const [row] = await db
    .update(sequences)
    .set({ emailsOrder: [...sequence.emailsOrder, email.emailId] })
    .where(eq(sequences.id, sequence.id))
    .returning();

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

  if (content) {
    verifyMandatoryTags((content as any).content || []);
  }

  const patch: Partial<SequenceEmail> = { updatedAt: new Date() };
  if (subject !== undefined) patch.subject = subject;
  if (content !== undefined) patch.content = content as any;
  if (delayInMillis !== undefined) patch.delayInMillis = delayInMillis;
  if (templateId !== undefined) patch.templateId = templateId;
  if (published !== undefined) patch.published = published;
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

  return getSequenceBySequenceId(teamId, sequenceId);
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

  return getSequenceBySequenceId(teamId, sequenceId);
}

export async function startSequence({
  teamId,
  sequenceId,
}: {
  teamId: string;
  sequenceId: string;
}): Promise<HydratedSequence> {
  const sequence = await getSequenceBySequenceId(teamId, sequenceId);
  if (!sequence) throw new Error(responses.item_not_found);

  if (!["draft", "paused"].includes(sequence.status)) {
    throw new Error(responses.sequence_already_started);
  }
  if (!sequence.emails.some((e) => e.published)) {
    throw new Error(responses.no_published_emails);
  }

  if (sequence.type === "sequence") {
    if (!sequence.title || !sequence.triggerType || !sequence.fromName) {
      throw new Error(`${responses.sequence_details_missing}: basics`);
    }
    if (
      [EventType.TAG_ADDED, EventType.TAG_REMOVED].includes(
        sequence.triggerType as any,
      ) &&
      !sequence.triggerData
    ) {
      throw new Error(`${responses.sequence_details_missing}: trigger`);
    }
  }

  if (sequence.type === "broadcast") {
    const filter = sequence.filter as ContactFilterWithAggregator | null;
    if (!filter || !filter.filters || filter.filters.length === 0) {
      throw new Error(`${responses.sequence_details_missing}: filter`);
    }
  }

  await addRule({
    teamId,
    sequenceId,
    triggerType: sequence.triggerType!,
    triggerData: sequence.triggerData,
    eventDateInMillis:
      sequence.type === "broadcast"
        ? sequence.emails[0].delayInMillis
        : undefined,
  });

  const [row] = await db
    .update(sequences)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(sequences.id, sequence.id))
    .returning();

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
    (report?.broadcast?.lockedAt ||
      sequence.emails[0].delayInMillis <= Date.now())
  ) {
    throw new Error(responses.mail_already_sent);
  }

  await removeRule({ teamId, sequenceId });

  const [row] = await db
    .update(sequences)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(sequences.id, sequence.id))
    .returning();

  return hydrate(row);
}

export async function getEmailSentCount(sequenceId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.sequenceId, sequenceId));
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
    .selectDistinct({ contactId: emailDeliveries.contactId })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.sequenceId, sequenceId))
    .limit(limit)
    .offset((Math.max(page, 1) - 1) * limit);
  return rows.map((r) => r.contactId);
}

export async function getSubscribersCount(sequenceId: string): Promise<number> {
  const rows = await db
    .selectDistinct({ contactId: emailDeliveries.contactId })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.sequenceId, sequenceId));
  return rows.length;
}

async function countDistinctContactsWithEvent(
  sequenceId: string,
  action: string,
): Promise<number> {
  const rows = await db
    .selectDistinct({ contactId: emailEvents.contactId })
    .from(emailEvents)
    .where(
      and(
        eq(emailEvents.sequenceId, sequenceId),
        eq(emailEvents.action, action),
      ),
    );
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

export async function getSequenceClickThroughRate(
  sequenceId: string,
): Promise<number> {
  const recipients = await getSubscribersCount(sequenceId);
  if (!recipients) return 0;
  const clickers = await countDistinctContactsWithEvent(
    sequenceId,
    EmailEventAction.CLICK,
  );
  return clickers / recipients;
}
