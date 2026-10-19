CREATE TABLE "organization_plan_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"teams_limit_override" integer,
	"contacts_limit_override" integer,
	"marketing_ramp_stage" integer DEFAULT 0 NOT NULL,
	"marketing_ramp_clean_days" integer DEFAULT 0 NOT NULL,
	"marketing_ramp_evaluated_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_plan_policies_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "organization_plan_policies_overrides_check" CHECK (("organization_plan_policies"."teams_limit_override" IS NULL OR "organization_plan_policies"."teams_limit_override" > 0)
                AND ("organization_plan_policies"."contacts_limit_override" IS NULL OR "organization_plan_policies"."contacts_limit_override" > 0)),
	CONSTRAINT "organization_plan_policies_ramp_check" CHECK ("organization_plan_policies"."marketing_ramp_stage" BETWEEN 0 AND 3 AND "organization_plan_policies"."marketing_ramp_clean_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trial_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"verified_email_fingerprint" text NOT NULL,
	"fingerprint_key_version" text NOT NULL,
	"trial_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"checkout_attempt_id" uuid,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_claims_status_check" CHECK ("trial_claims"."status" IN ('reserved', 'redeemed', 'released'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_team_name" text;--> statement-breakpoint
ALTER TABLE "organization_plan_policies" ADD CONSTRAINT "organization_plan_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claims_user_trial_uidx" ON "trial_claims" USING btree ("user_id","trial_key") WHERE "trial_claims"."status" <> 'released';--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claims_email_trial_uidx" ON "trial_claims" USING btree ("verified_email_fingerprint","trial_key") WHERE "trial_claims"."status" <> 'released';--> statement-breakpoint
CREATE INDEX "trial_claims_checkout_attempt_idx" ON "trial_claims" USING btree ("checkout_attempt_id");--> statement-breakpoint
-- Move SendLit's plan policy off the billing tables; 0009 drops the old
-- columns and billing_trial_claims. Every organization gets a policy row.
INSERT INTO "organization_plan_policies" ("id", "organization_id", "teams_limit_override", "contacts_limit_override", "marketing_ramp_stage", "marketing_ramp_clean_days", "marketing_ramp_evaluated_at", "past_due_since")
SELECT gen_random_uuid(), o."id", ps."teams_limit_override", ps."contacts_limit_override", COALESCE(ps."ramp_stage", 0), COALESCE(ps."ramp_clean_stage_days", 0), ps."ramp_evaluated_at", CASE WHEN s."status" = 'past_due' THEN s."past_due_at" END
FROM "organizations" o
LEFT JOIN "billing_plan_states" ps ON ps."billable_entity_id" = o."id"
LEFT JOIN "billing_subscriptions" s ON s."id" = ps."active_subscription_id"
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "trial_claims" ("id", "user_id", "verified_email_fingerprint", "fingerprint_key_version", "trial_key", "organization_id", "checkout_attempt_id", "status", "expires_at", "redeemed_at", "created_at", "updated_at")
SELECT "id", "user_id", "verified_email_fingerprint", "fingerprint_key_version", "trial_key", "organization_id", "checkout_attempt_id", "status", "expires_at", "redeemed_at", "created_at", "updated_at"
FROM "billing_trial_claims"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "organizations" o
SET "pending_team_name" = latest."pending_team_name"
FROM (
	SELECT DISTINCT ON ("billable_entity_id") "billable_entity_id", "pending_team_name"
	FROM "billing_checkout_attempts"
	WHERE "pending_team_name" IS NOT NULL
	ORDER BY "billable_entity_id", "created_at" DESC
) latest
WHERE latest."billable_entity_id" = o."id" AND o."status" = 'pending_payment';
