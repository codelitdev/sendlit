CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"mailing_address" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "settings_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" RENAME COLUMN "subscribed_to_updates" TO "subscribed";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "daily_mail_limit" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "monthly_mail_limit" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "daily_mail_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "monthly_mail_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "counters_reset_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "outbox_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_outbox_id_esp_configs_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."esp_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "active";--> statement-breakpoint
ALTER TABLE "sequences" DROP COLUMN IF EXISTS "from_name";--> statement-breakpoint
ALTER TABLE "sequences" DROP COLUMN IF EXISTS "from_email";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "from_name";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "from_email";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "mailing_address";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "daily_mail_limit";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "monthly_mail_limit";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "daily_mail_count";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "monthly_mail_count";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "counters_reset_at";