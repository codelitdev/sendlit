CREATE TABLE IF NOT EXISTS "transactional_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"txe_id" text NOT NULL,
	"to_email" text NOT NULL,
	"from_email" text,
	"reply_to" text,
	"subject" text NOT NULL,
	"template_id" text,
	"html" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headers" jsonb,
	"contact_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"idempotency_key" text,
	"track_opens" boolean DEFAULT false NOT NULL,
	"track_clicks" boolean DEFAULT false NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "transactional_emails_txe_id_unique" UNIQUE("txe_id"),
	CONSTRAINT "transactional_emails_txe_id_check" CHECK ("transactional_emails"."txe_id" ~ '^txe_')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transactional_emails_team_id_idempotency_key_idx" ON "transactional_emails" USING btree ("team_id","idempotency_key") WHERE "transactional_emails"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactional_emails_team_id_created_at_idx" ON "transactional_emails" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactional_emails_team_id_status_idx" ON "transactional_emails" USING btree ("team_id","status");