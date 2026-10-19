CREATE TABLE "reputation_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"account_label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alert_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reputation_connections_provider_check" CHECK ("reputation_connections"."provider" IN ('google_postmaster', 'microsoft_snds')),
	CONSTRAINT "reputation_connections_status_check" CHECK ("reputation_connections"."status" IN ('active', 'error'))
);
--> statement-breakpoint
CREATE TABLE "reputation_daily_stats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reputation_connections" ADD CONSTRAINT "reputation_connections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_daily_stats" ADD CONSTRAINT "reputation_daily_stats_connection_id_reputation_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."reputation_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reputation_connections_team_id_provider_idx" ON "reputation_connections" USING btree ("team_id","provider");--> statement-breakpoint
CREATE INDEX "reputation_connections_next_sync_at_idx" ON "reputation_connections" USING btree ("next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reputation_daily_stats_connection_subject_day_idx" ON "reputation_daily_stats" USING btree ("connection_id","subject","day");