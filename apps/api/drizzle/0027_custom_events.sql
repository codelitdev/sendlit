CREATE TABLE "contact_event_matches" (
	"contact_event_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contact_event_matches_contact_event_id_sequence_id_pk" PRIMARY KEY("contact_event_id","sequence_id")
);
--> statement-breakpoint
CREATE TABLE "contact_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"backfill" boolean DEFAULT false NOT NULL,
	"triggers" boolean NOT NULL,
	"source" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "contact_events_event_id_check" CHECK ("contact_events"."event_id" ~ '^evt_')
);
--> statement-breakpoint
CREATE TABLE "event_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"description" text,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_properties" jsonb,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_entries" (
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"first_entered_at" timestamp with time zone NOT NULL,
	"last_entered_at" timestamp with time zone NOT NULL,
	"entry_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sequence_entries_sequence_id_contact_id_pk" PRIMARY KEY("sequence_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "email_delivery_events" DROP CONSTRAINT "email_delivery_events_event_id_check";--> statement-breakpoint
ALTER TABLE "ongoing_sequences" ADD COLUMN "trigger_event" jsonb;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "event_filter" jsonb;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "trigger_filter" jsonb;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "reentry" text DEFAULT 'every_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "reentry_period_days" integer;--> statement-breakpoint
ALTER TABLE "contact_event_matches" ADD CONSTRAINT "contact_event_matches_contact_event_id_contact_events_id_fk" FOREIGN KEY ("contact_event_id") REFERENCES "public"."contact_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_event_matches" ADD CONSTRAINT "contact_event_matches_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_definitions" ADD CONSTRAINT "event_definitions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_entries" ADD CONSTRAINT "sequence_entries_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_entries" ADD CONSTRAINT "sequence_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_events_team_id_idempotency_key_idx" ON "contact_events" USING btree ("team_id","idempotency_key") WHERE "contact_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contact_events_contact_id_occurred_at_idx" ON "contact_events" USING btree ("contact_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_events_unprocessed_idx" ON "contact_events" USING btree ("created_at") WHERE "contact_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "event_definitions_team_id_name_idx" ON "event_definitions" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "rules_team_id_event_event_data_idx" ON "rules" USING btree ("team_id","event","event_data");--> statement-breakpoint
ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_event_id_check" CHECK ("email_delivery_events"."event_id" ~ '^(evt|dev)_');--> statement-breakpoint
-- Delivery events move from `evt_` to `dev_`; custom events take `evt_`.
UPDATE "email_delivery_events" SET "event_id" = 'dev_' || substring("event_id" from 5) WHERE "event_id" LIKE 'evt\_%';--> statement-breakpoint
-- Seed re-entry history from what we already know, so switching an existing
-- sequence to `once` doesn't let past entrants back in. Approximate: the true
-- entry count is unknown, so each pair starts at 1.
INSERT INTO "sequence_entries" ("sequence_id", "contact_id", "first_entered_at", "last_entered_at", "entry_count")
SELECT "sequence_id", "contact_id", min("entered_at"), max("entered_at"), 1
FROM (
	SELECT d."sequence_id", d."contact_id", coalesce(d."created_at", now()) AS "entered_at"
	FROM "email_deliveries" d
	JOIN "sequences" s ON s."id" = d."sequence_id" AND s."type" = 'sequence'
	UNION ALL
	SELECT o."sequence_id", o."contact_id", coalesce(o."created_at", now()) AS "entered_at"
	FROM "ongoing_sequences" o
	JOIN "sequences" s ON s."id" = o."sequence_id" AND s."type" = 'sequence'
) AS "history"
GROUP BY "sequence_id", "contact_id"
ON CONFLICT DO NOTHING;
