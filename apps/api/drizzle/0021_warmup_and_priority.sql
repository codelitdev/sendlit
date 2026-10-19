ALTER TABLE "esp_configs" ADD COLUMN "warmup_target_daily" integer;--> statement-breakpoint
ALTER TABLE "esp_configs" ADD COLUMN "warmup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ongoing_sequences" ADD COLUMN "priority" bigint DEFAULT 0 NOT NULL;