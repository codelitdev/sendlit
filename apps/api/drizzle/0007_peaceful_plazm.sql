CREATE TABLE IF NOT EXISTS "email_delivery_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"team_id" uuid,
	"outbound_message_id" uuid,
	"provider" text NOT NULL,
	"provider_event_key" text NOT NULL,
	"provider_message_id" text,
	"recipient_email" text,
	"normalized_recipient" text,
	"event_type" text NOT NULL,
	"bounce_class" text,
	"smtp_code" integer,
	"enhanced_status_code" text,
	"reason" text,
	"remote_mta" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "email_delivery_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "email_delivery_events_event_id_check" CHECK ("email_delivery_events"."event_id" ~ '^evt_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppression_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"suppression_id" uuid NOT NULL,
	"source_event_id" uuid,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"suppression_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"recipient_email" text,
	"normalized_recipient" text,
	"recipient_hash" text NOT NULL,
	"hash_key_version" integer NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"first_suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_suppressions_suppression_id_unique" UNIQUE("suppression_id"),
	CONSTRAINT "email_suppressions_suppression_id_check" CHECK ("email_suppressions"."suppression_id" ~ '^sup_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_feedback_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"scope" text NOT NULL,
	"team_id" uuid,
	"esp_config_id" uuid,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"expected_topic_arn" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_received_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "esp_feedback_connections_connection_id_unique" UNIQUE("connection_id"),
	CONSTRAINT "esp_feedback_connections_connection_id_check" CHECK ("esp_feedback_connections"."connection_id" ~ '^whc_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_webhook_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"team_id" uuid,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"body_sha256" text NOT NULL,
	"encrypted_payload" text,
	"safe_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "esp_webhook_receipts_receipt_id_unique" UNIQUE("receipt_id"),
	CONSTRAINT "esp_webhook_receipts_receipt_id_check" CHECK ("esp_webhook_receipts"."receipt_id" ~ '^whr_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"delivery_route" text NOT NULL,
	"esp_config_id" uuid,
	"feedback_connection_id" uuid,
	"source_type" text NOT NULL,
	"campaign_delivery_id" uuid,
	"transactional_email_id" uuid,
	"recipient_email" text NOT NULL,
	"normalized_recipient" text NOT NULL,
	"provider" text,
	"rfc_message_id" text,
	"provider_message_id" text,
	"delivery_status" text DEFAULT 'queued' NOT NULL,
	"feedback_status" text DEFAULT 'none' NOT NULL,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "outbound_messages_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "outbound_messages_message_id_check" CHECK ("outbound_messages"."message_id" ~ '^msg_')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_receipt_id_esp_webhook_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."esp_webhook_receipts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_suppression_id_email_suppressions_id_fk" FOREIGN KEY ("suppression_id") REFERENCES "public"."email_suppressions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_source_event_id_email_delivery_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_delivery_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_actor_user_id_accounts_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_source_event_id_email_delivery_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_delivery_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_released_by_accounts_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_feedback_connections" ADD CONSTRAINT "esp_feedback_connections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_feedback_connections" ADD CONSTRAINT "esp_feedback_connections_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_webhook_receipts" ADD CONSTRAINT "esp_webhook_receipts_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_webhook_receipts" ADD CONSTRAINT "esp_webhook_receipts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_feedback_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("feedback_connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_delivery_id_email_deliveries_id_fk" FOREIGN KEY ("campaign_delivery_id") REFERENCES "public"."email_deliveries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_transactional_email_id_transactional_emails_id_fk" FOREIGN KEY ("transactional_email_id") REFERENCES "public"."transactional_emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_delivery_events_connection_id_provider_event_key_idx" ON "email_delivery_events" USING btree ("connection_id","provider_event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_team_id_occurred_at_idx" ON "email_delivery_events" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_outbound_message_id_idx" ON "email_delivery_events" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_suppression_actions_suppression_id_created_at_idx" ON "email_suppression_actions" USING btree ("suppression_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_team_id_recipient_hash_idx" ON "email_suppressions" USING btree ("team_id","recipient_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_suppressions_team_id_active_idx" ON "email_suppressions" USING btree ("team_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_feedback_connections_team_id_idx" ON "esp_feedback_connections" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esp_feedback_connections_esp_config_active_idx" ON "esp_feedback_connections" USING btree ("esp_config_id") WHERE "esp_feedback_connections"."esp_config_id" is not null and "esp_feedback_connections"."status" not in ('retiring', 'disabled');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_webhook_receipts_status_next_attempt_idx" ON "esp_webhook_receipts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_webhook_receipts_connection_id_provider_request_id_idx" ON "esp_webhook_receipts" USING btree ("connection_id","provider_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_team_id_created_at_idx" ON "outbound_messages" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_connection_provider_msg_idx" ON "outbound_messages" USING btree ("feedback_connection_id","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_team_id_recipient_created_at_idx" ON "outbound_messages" USING btree ("team_id","normalized_recipient","created_at");