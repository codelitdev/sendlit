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
