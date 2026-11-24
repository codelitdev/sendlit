ALTER TABLE "settings" ADD COLUMN "postal_address" jsonb;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "mailing_address";