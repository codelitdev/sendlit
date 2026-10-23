ALTER TABLE "sequences" ADD COLUMN "web_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_slug" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_seo_title" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_seo_description" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_og_image" text;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_noindex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "web_canonical_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "web_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "web_handle" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "web_title" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "web_description" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "web_signup_form_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_web_signup_form_id_signup_forms_id_fk" FOREIGN KEY ("web_signup_form_id") REFERENCES "public"."signup_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_team_id_web_slug_idx" ON "sequences" USING btree ("team_id","web_slug") WHERE "sequences"."web_slug" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_web_handle_unique" UNIQUE("web_handle");