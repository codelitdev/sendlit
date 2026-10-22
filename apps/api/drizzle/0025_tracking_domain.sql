ALTER TABLE "settings" ADD COLUMN "tracking_domain" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracking_domain_status" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracking_domain_error" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracking_domain_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracking_domain_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracking_domain_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "retired_tracking_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_tracking_domain_unique" UNIQUE("tracking_domain");