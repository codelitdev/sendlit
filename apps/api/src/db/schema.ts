import {
    pgTable,
    uuid,
    text,
    timestamp,
    integer,
    bigint,
    boolean,
    jsonb,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A SendLit "account" is a login identity (one email = one account, OTP-based —
 * mirrors MediaLit's OAuth user model). An account owns/belongs to one or more
 * `teams`; a team — not the account — is the actual tenant/data-scope: every
 * other resource (contacts, templates, sequences, ESP config, API keys, ...) is
 * scoped by `teamId`, never `accountId`. This is what lets a single account
 * manage several independent "newsletters"/workspaces, and lets a consumer
 * (e.g. a multi-tenant app like CourseLit) provision one team per one of its
 * own tenants without their contacts/sending-identity/quota colliding.
 */
export const accounts = pgTable("accounts", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** The tenant/data-scope boundary. Sending identity and mail quota live here
 * (not on `accounts`) since they're properties of the "workspace", not the
 * login. `externalId` is an optional stable key for programmatic provisioning
 * by a consumer system (see `provisioning/routes.ts`) — e.g. `courselit:<domainId>` —
 * so a team can be found-or-created idempotently without relying on email
 * uniqueness (a consumer's own tenants may share an owner email). */
export const teams = pgTable("teams", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ownerAccountId: uuid("owner_account_id")
        .notNull()
        .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").unique(),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    mailingAddress: text("mailing_address"),
    dailyMailLimit: integer("daily_mail_limit").notNull().default(1000),
    monthlyMailLimit: integer("monthly_mail_limit").notNull().default(30000),
    dailyMailCount: integer("daily_mail_count").notNull().default(0),
    monthlyMailCount: integer("monthly_mail_count").notNull().default(0),
    countersResetAt: timestamp("counters_reset_at", {
        withTimezone: true,
    }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Which accounts can act on behalf of a team. Every team gets exactly one
 * `owner` row (its creator) today — member invitations are a follow-up — but
 * the shape already supports many accounts per team and many teams per account. */
export const teamMembers = pgTable(
    "team_members",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        accountId: uuid("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        role: text("role").notNull().default("owner"), // 'owner' | 'member'
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        teamAccountIdx: uniqueIndex("team_members_team_id_account_id_idx").on(
            table.teamId,
            table.accountId,
        ),
    }),
);

/** Dynamically registered OAuth clients (RFC 7591 DCR). Static clients (web/mobile)
 * are declared in code — see `oauth/model.ts`. */
export const oauthClients = pgTable("oauth_clients", {
    clientId: text("client_id").primaryKey(),
    clientIdIssuedAt: bigint("client_id_issued_at", {
        mode: "number",
    }).notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    grantTypes: text("grant_types").array().notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method")
        .notNull()
        .default("none"),
    clientName: text("client_name"),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Transient state for the email-OTP powered `/oauth/authorize` flow. */
export const oauthPendingAuth = pgTable("oauth_pending_auth", {
    pendingId: text("pending_id").primaryKey(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    state: text("state"),
    scope: text("scope"),
    email: text("email"),
    otpHash: text("otp_hash"),
    otpExpires: bigint("otp_expires", { mode: "number" }),
    otpSentAt: bigint("otp_sent_at", { mode: "number" }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    authorizationCode: text("authorization_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Revoked refresh tokens, keyed by JWT id (`jti`). Access tokens are short-lived
 * and are not tracked here (see `oauth/jwt.ts`). */
export const oauthRevokedTokens = pgTable("oauth_revoked_tokens", {
    jti: text("jti").primaryKey(),
    tokenType: text("token_type").notNull(),
    accountId: text("account_id").notNull(),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).defaultNow(),
});

/** A key authenticates as exactly one team — never an account directly — so a
 * team can hand out several independently-revocable keys (e.g. one for a
 * CourseLit integration, another for a Zapier zap) without any of them being
 * able to see another team the owning account belongs to. */
export const apiKeys = pgTable("api_keys", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** A contact is a recipient/subscriber. Equivalent of CourseLit's `User` model,
 * stripped of everything course/product related. */
export const contacts = pgTable(
    "contacts",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        contactId: text("contact_id").notNull().unique(),
        email: text("email").notNull(),
        name: text("name"),
        active: boolean("active").notNull().default(true),
        subscribedToUpdates: boolean("subscribed_to_updates")
            .notNull()
            .default(true),
        customFields: jsonb("custom_fields")
            .$type<Record<string, string>>()
            .notNull()
            .default({}),
        tags: text("tags").array().notNull().default([]),
        unsubscribeToken: text("unsubscribe_token").notNull().unique(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        teamEmailIdx: uniqueIndex("contacts_team_id_email_idx").on(
            table.teamId,
            table.email,
        ),
    }),
);

export const emailTemplates = pgTable(
    "email_templates",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        templateId: text("template_id").notNull().unique(),
        title: text("title").notNull(),
        // { content: EmailBlock[], style: EmailStyle, meta: EmailMeta } — see @sendlit/email-editor
        content: jsonb("content").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        teamTitleIdx: uniqueIndex("email_templates_team_id_title_idx").on(
            table.teamId,
            table.title,
        ),
    }),
);

/** A broadcast (one-off, `type = 'broadcast'`) or a sequence (multi-step,
 * `type = 'sequence'`) — same shape as CourseLit's `Sequence` model. */
export const sequences = pgTable("sequences", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
    sequenceId: text("sequence_id").notNull().unique(),
    type: text("type").notNull(), // 'broadcast' | 'sequence'
    title: text("title").notNull().default(""),
    status: text("status").notNull().default("draft"), // draft|active|paused|completed
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    triggerType: text("trigger_type"), // Constants.EventType
    triggerData: text("trigger_data"),
    // UserFilterWithAggregator — see contacts/segment.ts
    filter: jsonb("filter"),
    excludeFilter: jsonb("exclude_filter"),
    emailsOrder: text("emails_order").array().notNull().default([]),
    entrants: text("entrants").array().notNull().default([]),
    // { broadcast: { sentAt, lockedAt }, sequence: { subscribers, unsubscribers, failed } }
    report: jsonb("report").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sequenceEmails = pgTable(
    "sequence_emails",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sequenceId: uuid("sequence_id")
            .notNull()
            .references(() => sequences.id, { onDelete: "cascade" }),
        emailId: text("email_id").notNull(),
        subject: text("subject").notNull(),
        // { content: EmailBlock[], style: EmailStyle, meta: EmailMeta }
        content: jsonb("content").notNull(),
        delayInMillis: bigint("delay_in_millis", { mode: "number" })
            .notNull()
            .default(86400000),
        published: boolean("published").notNull().default(false),
        templateId: text("template_id"),
        actionType: text("action_type"), // tag:add | tag:remove
        actionData: jsonb("action_data"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        sequenceEmailIdx: uniqueIndex(
            "sequence_emails_sequence_id_email_id_idx",
        ).on(table.sequenceId, table.emailId),
    }),
);

/** A scheduled trigger for a sequence — e.g. "fire DATE_OCCURRED for broadcast X at
 * time T", processed by `automation/process-rules.ts`. */
export const rules = pgTable("rules", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull().unique(),
    event: text("event").notNull(), // Constants.EventType
    sequenceId: text("sequence_id").notNull(),
    eventDateInMillis: bigint("event_date_in_millis", { mode: "number" }),
    eventData: text("event_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** One row per (sequence, contact) currently being delivered. Processed by
 * `automation/process-ongoing-sequence.ts`. */
export const ongoingSequences = pgTable(
    "ongoing_sequences",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        sequenceId: text("sequence_id").notNull(),
        contactId: text("contact_id").notNull(),
        nextEmailScheduledTime: bigint("next_email_scheduled_time", {
            mode: "number",
        }).notNull(),
        retryCount: integer("retry_count").notNull().default(0),
        sentEmailIds: text("sent_email_ids").array().notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => ({
        sequenceContactIdx: uniqueIndex(
            "ongoing_sequences_sequence_id_contact_id_idx",
        ).on(table.sequenceId, table.contactId),
        // The 60s due-poll (`getDueOngoingSequences`) filters on this column.
        nextScheduledIdx: index(
            "ongoing_sequences_next_email_scheduled_time_idx",
        ).on(table.nextEmailScheduledTime),
    }),
);

export const emailDeliveries = pgTable("email_deliveries", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
    sequenceId: text("sequence_id").notNull(),
    contactId: text("contact_id").notNull(),
    emailId: text("email_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Per-team ESP (Email Service Provider) transport configuration. One row
 * per team — when present, outgoing mail for that team is sent through
 * this SMTP connection instead of the platform's default (`EMAIL_HOST` env
 * vars). `encryptedSecret` holds an AES-256-GCM encrypted JSON blob (see
 * `utils/secret-crypto.ts`) and is never returned to API clients. */
export const espConfigs = pgTable("esp_configs", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .unique()
        .references(() => teams.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("smtp"),
    host: text("host").notNull(),
    port: integer("port").notNull().default(587),
    secure: boolean("secure").notNull().default(false),
    username: text("username"),
    encryptedSecret: text("encrypted_secret"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestStatus: text("last_test_status"), // success | failed
    lastTestError: text("last_test_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const emailEvents = pgTable("email_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
    sequenceId: text("sequence_id").notNull(),
    contactId: text("contact_id").notNull(),
    emailId: text("email_id").notNull(),
    action: text("action").notNull(), // open | click | bounce
    link: text("link"),
    linkIndex: integer("link_index"),
    bounceType: text("bounce_type"), // hard | soft
    bounceReason: text("bounce_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
