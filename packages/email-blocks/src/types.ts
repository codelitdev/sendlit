import type { TemplatePurpose } from "@sendlit/api-contract/schemas/templates";
import type { Email } from "@sendlit/email-editor";

export type MailType = "broadcast" | "sequence";
export type SequenceStatus = "draft" | "active" | "paused" | "completed";
export type EmailActionType = "tag:add" | "tag:remove";

export type TriggerType =
  | "tag:added"
  | "tag:removed"
  | "subscriber:added"
  | "date:occurred";

export type ContactFilterName =
  | "tag"
  | "email"
  | "subscription"
  | "signedUp"
  | (string & {});

export interface ContactFilterCondition {
  name: ContactFilterName;
  condition: string;
  value?: string;
  key?: string;
  valueLabel?: string;
}

export interface ContactFilterWithAggregator {
  aggregator: "and" | "or";
  filters: ContactFilterCondition[];
}

export interface Contact {
  contactId: string;
  email: string;
  name?: string | null;
  subscribed: boolean;
  customFields: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  >;
  tags: string[];
  unsubscribeToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplate {
  templateId: string;
  title: string;
  purpose: TemplatePurpose;
  content: Email;
  requiredVariables: string[];
  /** A retired document that is listed only so its owner can delete it. */
  validationError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceEmail {
  emailId: string;
  subject: string;
  content: Email;
  delayInMillis: number;
  published: boolean;
  templateId?: string | null;
  actionType?: EmailActionType | null;
  actionData?: Record<string, unknown> | null;
  /** When a test of this email was last sent; `null` if never. */
  lastTestSentAt?: string | null;
  /** Hosted content check: clean, review, blocked or approved. */
  contentScanVerdict?: string | null;
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
  /** Set when SendLit paused a running send because of its bounce or
   * complaint rate, failures, or an ESP error. */
  autoPause?: {
    reason: "bounce_rate" | "complaint_rate" | "consecutive_failures" | "esp_error";
    at: number;
    bounceRate?: number;
    complaintRate?: number;
    error?: string;
  };
}

export interface Sequence {
  sequenceId: string;
  type: MailType | string;
  title: string;
  status: SequenceStatus | string;
  /** Requested source while draft/paused. `null` resolves the team default
   * at activation; an organization source never exposes credentials. */
  deliverySource?: { type: "organization" } | { type: "team"; espId?: string } | null;
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
  /** Set while a new hosted account's broadcast is sent gradually. */
  pacing?: {
    reason: "new_account";
    hourlyLimit: number;
    dailyLimit: number;
    remaining: number;
    estimatedCompletionAt: string;
  } | null;
}

export interface SequenceStats {
  sent: number;
  openRate: number;
  clickThroughRate: number;
  subscribersCount: number;
  /** Share of accepted emails that bounced / were marked as spam (0-1). */
  bounceRate?: number;
  complaintRate?: number;
}
