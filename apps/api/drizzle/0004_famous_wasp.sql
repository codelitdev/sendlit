CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"media_lit_id" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"file_name" text,
	"mime_type" text,
	"size" integer,
	"width" integer,
	"height" integer,
	"alt" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "media_media_id_unique" UNIQUE("media_id"),
	CONSTRAINT "media_media_id_check" CHECK ("media"."media_id" ~ '^med_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_internal_id" uuid NOT NULL,
	"resource_public_id" text NOT NULL,
	"parent_resource_internal_id" uuid,
	"parent_resource_public_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_references" ADD CONSTRAINT "media_references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_references" ADD CONSTRAINT "media_references_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_team_id_media_lit_id_idx" ON "media" USING btree ("team_id","media_lit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_team_id_created_at_idx" ON "media" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_references_resource_idx" ON "media_references" USING btree ("team_id","resource_type","resource_internal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_references_media_id_idx" ON "media_references" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_references_resource_media_idx" ON "media_references" USING btree ("team_id","resource_type","resource_internal_id","media_id");