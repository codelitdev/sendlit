CREATE TABLE "email_content_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_email_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"subject" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_content_versions_version_id_unique" UNIQUE("version_id"),
	CONSTRAINT "email_content_versions_version_id_check" CHECK ("email_content_versions"."version_id" ~ '^ver_')
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "email_content_versions" ADD CONSTRAINT "email_content_versions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_content_versions" ADD CONSTRAINT "email_content_versions_sequence_email_id_sequence_emails_id_fk" FOREIGN KEY ("sequence_email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_content_versions_email_hash_idx" ON "email_content_versions" USING btree ("sequence_email_id","content_hash");--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_content_version_id_email_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."email_content_versions"("id") ON DELETE set null ON UPDATE no action;