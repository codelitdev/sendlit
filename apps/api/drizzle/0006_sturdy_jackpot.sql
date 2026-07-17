ALTER TABLE "esp_configs" DROP CONSTRAINT "esp_configs_team_id_unique";--> statement-breakpoint
ALTER TABLE "esp_configs" ADD COLUMN "esp_id" text;--> statement-breakpoint
ALTER TABLE "esp_configs" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "esp_configs" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "delivery_route" text;--> statement-breakpoint
ALTER TABLE "transactional_emails" ADD COLUMN "delivery_route" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactional_emails" ADD COLUMN "outbox_id" uuid;--> statement-breakpoint
UPDATE "esp_configs"
SET
	"esp_id" = 'esp_' || substring(replace("id"::text, '-', '') from 1 for 24),
	"name" = COALESCE(NULLIF("from_name", ''), "provider" || ' ESP'),
	"is_default" = true;--> statement-breakpoint
ALTER TABLE "esp_configs" ALTER COLUMN "esp_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "esp_configs" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
UPDATE "sequences" AS "sequence"
SET
	"outbox_id" = "esp"."id",
	"delivery_route" = 'custom'
FROM "esp_configs" AS "esp"
WHERE "sequence"."team_id" = "esp"."team_id"
	AND "sequence"."outbox_id" IS NULL;--> statement-breakpoint
UPDATE "sequences"
SET "delivery_route" = 'custom'
WHERE "outbox_id" IS NOT NULL;--> statement-breakpoint
UPDATE "transactional_emails" AS "email"
SET "outbox_id" = "esp"."id"
FROM "esp_configs" AS "esp"
WHERE "email"."team_id" = "esp"."team_id";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_outbox_id_esp_configs_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."esp_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_configs_team_id_idx" ON "esp_configs" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esp_configs_team_id_default_idx" ON "esp_configs" USING btree ("team_id") WHERE "esp_configs"."is_default" = true;--> statement-breakpoint
ALTER TABLE "esp_configs" ADD CONSTRAINT "esp_configs_esp_id_unique" UNIQUE("esp_id");--> statement-breakpoint
ALTER TABLE "esp_configs" ADD CONSTRAINT "esp_configs_esp_id_check" CHECK ("esp_configs"."esp_id" ~ '^esp_');
