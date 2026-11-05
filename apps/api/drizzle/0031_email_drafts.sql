ALTER TABLE "email_content_versions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ongoing_sequences" ADD COLUMN "pinned_versions" jsonb;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "draft_subject" text;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "draft_content" jsonb;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "draft_updated_at" timestamp with time zone;