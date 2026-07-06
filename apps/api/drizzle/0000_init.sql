CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_custom_field_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_type" text NOT NULL,
	"value_text" text,
	"value_number" double precision,
	"value_boolean" boolean,
	"value_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"contact_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"subscribed_to_updates" boolean DEFAULT true NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contacts_contact_id_unique" UNIQUE("contact_id"),
	CONSTRAINT "contacts_unsubscribe_token_unique" UNIQUE("unsubscribe_token"),
	CONSTRAINT "contacts_contact_id_check" CHECK ("contacts"."contact_id" ~ '^cnt_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"action" text NOT NULL,
	"link" text,
	"link_index" integer,
	"bounce_type" text,
	"bounce_reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_templates_template_id_unique" UNIQUE("template_id"),
	CONSTRAINT "email_templates_template_id_check" CHECK ("email_templates"."template_id" ~ '^tpl_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" text DEFAULT 'smtp' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text,
	"encrypted_secret" text,
	"from_name" text,
	"from_email" text,
	"last_tested_at" timestamp with time zone,
	"last_test_status" text,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "esp_configs_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_id_issued_at" bigint NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"client_name" text,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_pending_auth" (
	"pending_id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text,
	"code_challenge_method" text,
	"state" text,
	"scope" text,
	"email" text,
	"otp_hash" text,
	"otp_expires" bigint,
	"otp_sent_at" bigint,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"authorization_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_revoked_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"token_type" text NOT NULL,
	"account_id" text NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ongoing_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"next_email_scheduled_time" bigint NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"sent_email_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"event" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"event_date_in_millis" bigint,
	"event_data" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "rules_rule_id_unique" UNIQUE("rule_id"),
	CONSTRAINT "rules_rule_id_check" CHECK ("rules"."rule_id" ~ '^rule_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"segment_id" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "segments_segment_id_unique" UNIQUE("segment_id"),
	CONSTRAINT "segments_segment_id_check" CHECK ("segments"."segment_id" ~ '^seg_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence_id" uuid NOT NULL,
	"email_id" text NOT NULL,
	"subject" text NOT NULL,
	"content" jsonb NOT NULL,
	"delay_in_millis" bigint DEFAULT 86400000 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"template_id" text,
	"action_type" text,
	"action_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sequence_emails_email_id_check" CHECK ("sequence_emails"."email_id" ~ '^email_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"from_name" text,
	"from_email" text,
	"trigger_type" text,
	"trigger_data" text,
	"filter" jsonb,
	"exclude_filter" jsonb,
	"emails_order" text[] DEFAULT '{}' NOT NULL,
	"entrants" text[] DEFAULT '{}' NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sequences_sequence_id_unique" UNIQUE("sequence_id"),
	CONSTRAINT "sequences_sequence_id_check" CHECK ("sequences"."sequence_id" ~ '^seq_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"external_id" text,
	"from_name" text,
	"from_email" text,
	"mailing_address" text,
	"daily_mail_limit" integer DEFAULT 1000 NOT NULL,
	"monthly_mail_limit" integer DEFAULT 30000 NOT NULL,
	"daily_mail_count" integer DEFAULT 0 NOT NULL,
	"monthly_mail_count" integer DEFAULT 0 NOT NULL,
	"counters_reset_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "teams_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "teams_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "teams_team_id_check" CHECK ("teams"."team_id" ~ '^team_')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_email_id_sequence_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_sequence_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_configs" ADD CONSTRAINT "esp_configs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segments" ADD CONSTRAINT "segments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_emails" ADD CONSTRAINT "sequence_emails_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_contact_key_idx" ON "contact_custom_field_values" USING btree ("team_id","contact_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_text_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_number_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_boolean_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_boolean");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_date_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_team_id_email_idx" ON "contacts" USING btree ("team_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_team_id_title_idx" ON "email_templates" USING btree ("team_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ongoing_sequences_sequence_id_contact_id_idx" ON "ongoing_sequences" USING btree ("sequence_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ongoing_sequences_next_email_scheduled_time_idx" ON "ongoing_sequences" USING btree ("next_email_scheduled_time");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "segments_team_id_name_idx" ON "segments" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_emails_sequence_id_email_id_idx" ON "sequence_emails" USING btree ("sequence_id","email_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_id_account_id_idx" ON "team_members" USING btree ("team_id","account_id");