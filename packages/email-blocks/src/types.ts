import type { Email } from "@sendlit/email-editor";

export type MailType = "broadcast" | "sequence";
export type SequenceStatus = "draft" | "active" | "paused" | "completed";
export type EmailActionType = "tag:add" | "tag:remove";

export type TriggerType =
  "tag:added" | "tag:removed" | "subscriber:added" | "date:occurred";

export type ContactFilterName = "tag" | "email" | "subscription" | "signedUp";

export interface ContactFilterCondition {
  name: ContactFilterName;
  condition: string;
  value: string;
  valueLabel?: string;
}

export interface ContactFilterWithAggregator {
  aggregator: "and" | "or";
  filters: ContactFilterCondition[];
}

export interface Contact {
  id: string;
  teamId: string;
  contactId: string;
  email: string;
  name?: string | null;
  active: boolean;
  subscribedToUpdates: boolean;
  customFields: Record<string, string>;
  tags: string[];
  unsubscribeToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplate {
  id: string;
  teamId: string;
  templateId: string;
  title: string;
  content: Email;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceEmail {
  id: string;
  sequenceId: string;
  emailId: string;
  subject: string;
  content: Email;
  delayInMillis: number;
  published: boolean;
  templateId?: string | null;
  actionType?: EmailActionType | null;
  actionData?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceReport {
  broadcast?: { sentAt: number | null; lockedAt: number | null };
  sequence?: {
    subscribers?: string[];
    unsubscribers?: string[];
    failed?: string[];
  };
}

export interface Sequence {
  id: string;
  teamId: string;
  sequenceId: string;
  type: MailType;
  title: string;
  status: SequenceStatus;
  fromName?: string | null;
  fromEmail?: string | null;
  triggerType?: TriggerType | string | null;
  triggerData?: string | null;
  filter?: ContactFilterWithAggregator | null;
  excludeFilter?: ContactFilterWithAggregator | null;
  emailsOrder: string[];
  entrants: string[];
  report: SequenceReport;
  createdAt: string;
  updatedAt: string;
  emails: SequenceEmail[];
}

export interface SequenceStats {
  sent: number;
  openRate: number;
  clickThroughRate: number;
  subscribersCount: number;
}
