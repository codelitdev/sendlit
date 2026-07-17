export const dbConnectionString = process.env.DB_CONNECTION_STRING;

export const HOUR_IN_SECONDS = 60 * 60 * 1000;

export const sequenceBounceLimit = process.env.SEQUENCE_BOUNCE_LIMIT
    ? +process.env.SEQUENCE_BOUNCE_LIMIT
    : 3;

export const sequenceDelayBetweenMailsInMillis = process.env
    .SEQUENCE_DELAY_BETWEEN_MAILS
    ? +process.env.SEQUENCE_DELAY_BETWEEN_MAILS
    : 86400000;

export const mailTypes = ["broadcast", "sequence"] as const;
export type MailType = (typeof mailTypes)[number];

export const sequenceStatus = [
    "draft",
    "active",
    "paused",
    "completed",
] as const;
export type SequenceStatus = (typeof sequenceStatus)[number];

export const emailActionTypes = ["tag:add", "tag:remove"] as const;
export type EmailActionType = (typeof emailActionTypes)[number];

export const transactionalEmailStatus = [
    "queued",
    "sent",
    "failed",
    "bounced",
    "suppressed",
] as const;
export type TransactionalEmailStatus =
    (typeof transactionalEmailStatus)[number];

/**
 * The subset of CourseLit's `Constants.EventType` that makes sense without a
 * course/community platform behind SendLit.
 */
export const EventType = {
    TAG_ADDED: "tag:added",
    TAG_REMOVED: "tag:removed",
    SUBSCRIBER_ADDED: "subscriber:added",
    DATE_OCCURRED: "date:occurred",
} as const;
export type Event = (typeof EventType)[keyof typeof EventType];

export const EmailEventAction = {
    OPEN: "open",
    CLICK: "click",
    BOUNCE: "bounce",
} as const;
export type EmailEventActionType =
    (typeof EmailEventAction)[keyof typeof EmailEventAction];

export const UserFilter = {
    EMAIL: "email",
    TAG: "tag",
    SUBSCRIPTION: "subscription",
    SIGNED_UP: "signedUp",
} as const;

export const userFilterAggregationOperators = ["and", "or"] as const;

export const itemsPerPage = 20;

// ---- Bounce and complaint processing (docs/bounces-and-complaints.md) -----

/** Providers that ship a reviewed webhook adapter and may be presented as
 * feedback-capable. SES is on the ESP provider list for SMTP sending but does
 * not yet have a feedback adapter (its SNS ingestion differs materially — see
 * `docs/aws-bounces-and-complaints.md`). */
export const feedbackCapableProviders = [
    "resend",
    "postmark",
    "sendgrid",
    "mailgun",
] as const;
export type FeedbackCapableProvider = (typeof feedbackCapableProviders)[number];

export const outboundDeliveryStatus = [
    "queued",
    "accepted",
    "delayed",
    "delivered",
    "bounced",
    "failed",
] as const;
export type OutboundDeliveryStatus = (typeof outboundDeliveryStatus)[number];

export const outboundFeedbackStatus = ["none", "complained"] as const;
export type OutboundFeedbackStatus = (typeof outboundFeedbackStatus)[number];

export const outboundSourceType = ["campaign", "transactional"] as const;
export type OutboundSourceType = (typeof outboundSourceType)[number];

export const deliveryRoutes = ["custom", "platform"] as const;
export type DeliveryRoute = (typeof deliveryRoutes)[number];

export const feedbackConnectionScope = ["custom", "platform"] as const;
export type FeedbackConnectionScope = (typeof feedbackConnectionScope)[number];

export const feedbackConnectionStatus = [
    "pending",
    "healthy",
    "stale",
    "error",
    "retiring",
    "disabled",
] as const;
export type FeedbackConnectionStatus =
    (typeof feedbackConnectionStatus)[number];

export const webhookReceiptStatus = [
    "pending",
    "processing",
    "processed",
    "partial",
    "dead_letter",
] as const;
export type WebhookReceiptStatus = (typeof webhookReceiptStatus)[number];

export const deliveryEventType = [
    "accepted",
    "delivered",
    "delayed",
    "soft_bounce",
    "hard_bounce",
    "failed",
    "complaint",
    "suppressed",
    "rejected",
    "unknown",
] as const;
export type DeliveryEventType = (typeof deliveryEventType)[number];

export const bounceClass = ["permanent", "transient", "undetermined"] as const;
export type BounceClass = (typeof bounceClass)[number];

export const suppressionReason = [
    "hard_bounce",
    "complaint",
    "repeated_soft_bounce",
    "provider_suppression",
    "manual",
] as const;
export type SuppressionReason = (typeof suppressionReason)[number];

/** Precedence used when merging repeated suppression signals for the same
 * recipient — earlier entries win. See "Strongest-reason precedence" in the
 * PRD's suppression model. */
export const suppressionReasonStrength: Record<SuppressionReason, number> = {
    complaint: 4,
    hard_bounce: 3,
    provider_suppression: 2,
    repeated_soft_bounce: 1,
    manual: 0,
};

export const suppressionAction = [
    "created",
    "reason_changed",
    "released",
    "reactivated",
] as const;
export type SuppressionAction = (typeof suppressionAction)[number];

export const suppressionActorType = [
    "system",
    "workspace_user",
    "sendlit_operator",
] as const;
export type SuppressionActorType = (typeof suppressionActorType)[number];

/** Reasons a workspace owner may release without operator involvement — a
 * complaint can never be self-released in v1 (PRD "Reactivation policy"). */
export const ownerReleasableSuppressionReasons: SuppressionReason[] = [
    "hard_bounce",
    "repeated_soft_bounce",
    "manual",
];

/** Consecutive final soft bounces (per distinct outbound message) within the
 * rolling window below that trigger automatic suppression. */
export const finalSoftBounceSuppressionThreshold = 3;
export const finalSoftBounceWindowDays = 30;
