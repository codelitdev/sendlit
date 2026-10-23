CREATE TABLE "abuse_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flag_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid,
	"user_id" text,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sequence_email_id" uuid,
	"content_hash" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abuse_flags_flag_id_unique" UNIQUE("flag_id"),
	CONSTRAINT "abuse_flags_flag_id_check" CHECK ("abuse_flags"."flag_id" ~ '^abf_'),
	CONSTRAINT "abuse_flags_kind_check" CHECK ("abuse_flags"."kind" IN ('signup', 'content', 'import')),
	CONSTRAINT "abuse_flags_severity_check" CHECK ("abuse_flags"."severity" IN ('low', 'medium', 'high')),
	CONSTRAINT "abuse_flags_status_check" CHECK ("abuse_flags"."status" IN ('open', 'released', 'confirmed'))
);
--> statement-breakpoint
ALTER TABLE "team_sending_controls" DROP CONSTRAINT "team_sending_controls_source_check";--> statement-breakpoint
ALTER TABLE "organization_plan_policies" ADD COLUMN "pacing_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_plan_policies" ADD COLUMN "signup_risk_score" integer;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "content_scan_verdict" text;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "content_scan_hash" text;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "content_scan_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "sequence_emails" ADD COLUMN "content_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_sequence_email_id_sequence_emails_id_fk" FOREIGN KEY ("sequence_email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_flags_status_created_at_idx" ON "abuse_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "abuse_flags_organization_kind_status_idx" ON "abuse_flags" USING btree ("organization_id","kind","status");--> statement-breakpoint
ALTER TABLE "team_sending_controls" ADD CONSTRAINT "team_sending_controls_source_check" CHECK ("team_sending_controls"."source" IN ('automatic', 'operator', 'abuse'));