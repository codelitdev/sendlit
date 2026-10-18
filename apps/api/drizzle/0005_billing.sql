CREATE TABLE IF NOT EXISTS "plan_send_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_send_reservations_amount_check" CHECK ("plan_send_reservations"."amount" > 0),
	CONSTRAINT "plan_send_reservations_state_check" CHECK ("plan_send_reservations"."state" IN ('reserved', 'committed', 'released'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_send_usage_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bucket_month" timestamp with time zone NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_send_usage_buckets_count_check" CHECK ("plan_send_usage_buckets"."committed" >= 0 AND "plan_send_usage_buckets"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sending_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"challenge_token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"failed_check_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_domains_domain_id_unique" UNIQUE("domain_id"),
	CONSTRAINT "sending_domains_domain_id_check" CHECK ("sending_domains"."domain_id" ~ '^domain_'),
	CONSTRAINT "sending_domains_status_check" CHECK ("sending_domains"."status" IN ('pending', 'verified', 'revoked', 'failed')),
	CONSTRAINT "sending_domains_failed_check_count_check" CHECK ("sending_domains"."failed_check_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_sending_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"status" text DEFAULT 'normal' NOT NULL,
	"reason_code" text,
	"source" text DEFAULT 'automatic' NOT NULL,
	"entered_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"minimum_hold_until" timestamp with time zone,
	"operator_user_id" text,
	"operator_reason" text,
	"overridden_at" timestamp with time zone,
	"clean_evaluation_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_sending_controls_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "team_sending_controls_status_check" CHECK ("team_sending_controls"."status" IN ('normal', 'warned', 'marketing_paused', 'all_paused')),
	CONSTRAINT "team_sending_controls_source_check" CHECK ("team_sending_controls"."source" IN ('automatic', 'operator')),
	CONSTRAINT "team_sending_controls_clean_days_check" CHECK ("team_sending_controls"."clean_evaluation_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_catalog_revision_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_revision_id" uuid NOT NULL,
	"offer_key" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_catalog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer NOT NULL,
	"checkout_provider" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_catalog_revisions_revision_unique" UNIQUE("revision"),
	CONSTRAINT "billing_catalog_revisions_status_check" CHECK ("billing_catalog_revisions"."status" IN ('pending_verification', 'active', 'retired', 'invalid', 'abandoned')),
	CONSTRAINT "billing_catalog_revisions_revision_check" CHECK ("billing_catalog_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" text NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"payer_id" text NOT NULL,
	"payer_email" text DEFAULT '' NOT NULL,
	"return_url" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"catalog_revision" integer NOT NULL,
	"offer_key" text NOT NULL,
	"requested_plan" text NOT NULL,
	"requested_interval" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL,
	"quoted_amount_minor" integer NOT NULL,
	"quoted_currency" text NOT NULL,
	"billing_customer_id" uuid,
	"provider_checkout_session_id" text,
	"checkout_url_encrypted" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_team_name" text,
	CONSTRAINT "billing_checkout_attempts_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "billing_checkout_attempts_status_check" CHECK ("billing_checkout_attempts"."status" IN ('creating', 'open', 'completed', 'expired', 'abandoned', 'conflicted')),
	CONSTRAINT "billing_checkout_attempts_amount_check" CHECK ("billing_checkout_attempts"."quoted_amount_minor" > 0),
	CONSTRAINT "billing_checkout_attempts_plan_check" CHECK ("billing_checkout_attempts"."requested_plan" IN ('pro', 'business')),
	CONSTRAINT "billing_checkout_attempts_interval_check" CHECK ("billing_checkout_attempts"."requested_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_plan_change_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" text NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"current_catalog_revision" integer NOT NULL,
	"current_billing_price_entry_id" uuid NOT NULL,
	"current_plan" text NOT NULL,
	"current_interval" text NOT NULL,
	"target_catalog_revision" integer NOT NULL,
	"target_billing_price_entry_id" uuid NOT NULL,
	"target_plan" text NOT NULL,
	"target_interval" text NOT NULL,
	"target_offer_key" text NOT NULL,
	"effective_at" text NOT NULL,
	"proration_mode" text NOT NULL,
	"provider_payment_id" text,
	"payment_url_encrypted" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plan_change_attempts_change_id_unique" UNIQUE("change_id"),
	CONSTRAINT "billing_plan_change_attempts_status_check" CHECK ("billing_plan_change_attempts"."status" IN ('creating', 'pending', 'succeeded', 'failed', 'conflicted')),
	CONSTRAINT "billing_plan_change_attempts_effective_at_check" CHECK ("billing_plan_change_attempts"."effective_at" IN ('immediately', 'next_billing_date')),
	CONSTRAINT "billing_plan_change_attempts_proration_mode_check" CHECK ("billing_plan_change_attempts"."proration_mode" IN ('prorated_immediately', 'do_not_bill')),
	CONSTRAINT "billing_plan_change_attempts_current_plan_check" CHECK ("billing_plan_change_attempts"."current_plan" IN ('pro', 'business')),
	CONSTRAINT "billing_plan_change_attempts_target_plan_check" CHECK ("billing_plan_change_attempts"."target_plan" IN ('pro', 'business'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_plan_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"active_subscription_id" uuid,
	"projection_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan" text NOT NULL,
	"teams_limit_override" integer,
	"contacts_limit_override" integer,
	"first_paid_activated_at" timestamp with time zone,
	"ramp_stage" integer NOT NULL,
	"ramp_clean_stage_days" integer NOT NULL,
	"ramp_evaluated_at" timestamp with time zone,
	CONSTRAINT "billing_plan_states_billable_entity_id_unique" UNIQUE("billable_entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_price_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_key" text NOT NULL,
	"plan" text NOT NULL,
	"billing_interval" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"provider_trial_days" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_price_entries_amount_check" CHECK ("billing_price_entries"."amount_minor" > 0),
	CONSTRAINT "billing_price_entries_trial_days_check" CHECK ("billing_price_entries"."provider_trial_days" >= 0),
	CONSTRAINT "billing_price_entries_currency_check" CHECK ("billing_price_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_price_entries_plan_check" CHECK ("billing_price_entries"."plan" IN ('pro', 'business')),
	CONSTRAINT "billing_price_entries_interval_check" CHECK ("billing_price_entries"."billing_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_provider_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"payer_id" text NOT NULL,
	"payer_email" text DEFAULT '' NOT NULL,
	"provider_customer_id" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_customers_status_check" CHECK ("billing_provider_customers"."status" IN ('creating', 'active', 'conflicted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_reconciliation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"checkout_attempt_id" uuid,
	"plan_change_attempt_id" uuid,
	"subscription_id" uuid,
	"provider_customer_id" uuid,
	"operation" text DEFAULT 'reconcile' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_jobs_exactly_one_subject" CHECK (((CASE WHEN "billing_reconciliation_jobs"."checkout_attempt_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."plan_change_attempt_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."subscription_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."provider_customer_id" IS NOT NULL THEN 1 ELSE 0 END)) = 1),
	CONSTRAINT "billing_reconciliation_jobs_status_check" CHECK ("billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed', 'completed', 'quarantined')),
	CONSTRAINT "billing_reconciliation_jobs_operation_check" CHECK ("billing_reconciliation_jobs"."operation" = 'reconcile' OR ("billing_reconciliation_jobs"."operation" = 'cancellation' AND "billing_reconciliation_jobs"."subscription_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"billing_customer_id" uuid NOT NULL,
	"payer_id" text NOT NULL,
	"origin_checkout_attempt_id" uuid,
	"provider" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL,
	"catalog_revision" integer NOT NULL,
	"offer_key" text NOT NULL,
	"plan" text NOT NULL,
	"billing_interval" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_period_starts_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"paid_through_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"is_entitlement_source" boolean DEFAULT false NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"provider_version" text,
	"last_observed_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"past_due_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	CONSTRAINT "billing_subscriptions_status_check" CHECK ("billing_subscriptions"."status" IN ('pending', 'trialing', 'active', 'past_due', 'cancelled', 'expired')),
	CONSTRAINT "billing_subscriptions_plan_check" CHECK ("billing_subscriptions"."plan" IN ('pro', 'business')),
	CONSTRAINT "billing_subscriptions_interval_check" CHECK ("billing_subscriptions"."billing_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subscription_id" text,
	"checkout_attempt_id" text,
	"payload_encrypted" text,
	"payload_key_version" text,
	"verified_key_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_events_status_check" CHECK ("billing_webhook_events"."status" IN ('pending', 'processing', 'processed', 'ignored', 'quarantined', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_trial_claims" (
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
	CONSTRAINT "billing_trial_claims_status_check" CHECK ("billing_trial_claims"."status" IN ('reserved', 'redeemed', 'released'))
);
--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_status_check";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_send_reservations" ADD CONSTRAINT "plan_send_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_send_reservations" ADD CONSTRAINT "plan_send_reservations_bucket_id_plan_send_usage_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."plan_send_usage_buckets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_send_usage_buckets" ADD CONSTRAINT "plan_send_usage_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_sending_controls" ADD CONSTRAINT "team_sending_controls_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_sending_controls" ADD CONSTRAINT "team_sending_controls_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_catalog_revision_items" ADD CONSTRAINT "billing_catalog_revision_items_catalog_revision_id_billing_catalog_revisions_id_fk" FOREIGN KEY ("catalog_revision_id") REFERENCES "public"."billing_catalog_revisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_catalog_revision_items" ADD CONSTRAINT "billing_catalog_revision_items_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billable_entity_id_organizations_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_payer_id_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billing_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_billable_entity_id_organizations_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_payer_id_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_current_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("current_billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_target_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("target_billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_states" ADD CONSTRAINT "billing_plan_states_billable_entity_id_organizations_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_states" ADD CONSTRAINT "billing_plan_states_active_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("active_subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_provider_customers" ADD CONSTRAINT "billing_provider_customers_payer_id_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_checkout_attempt_id_billing_checkout_attempts_id_fk" FOREIGN KEY ("checkout_attempt_id") REFERENCES "public"."billing_checkout_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_plan_change_attempt_id_billing_plan_change_attempts_id_fk" FOREIGN KEY ("plan_change_attempt_id") REFERENCES "public"."billing_plan_change_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_provider_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("provider_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billable_entity_id_organizations_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_payer_id_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_origin_checkout_attempt_id_billing_checkout_attempts_id_fk" FOREIGN KEY ("origin_checkout_attempt_id") REFERENCES "public"."billing_checkout_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_checkout_attempt_id_billing_checkout_attempts_id_fk" FOREIGN KEY ("checkout_attempt_id") REFERENCES "public"."billing_checkout_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_send_reservations_outbound_uidx" ON "plan_send_reservations" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_send_reservations_expiry_idx" ON "plan_send_reservations" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_send_usage_buckets_organization_month_uidx" ON "plan_send_usage_buckets" USING btree ("organization_id","bucket_month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sending_domains_organization_domain_uidx" ON "sending_domains" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revision_items_revision_key_uidx" ON "billing_catalog_revision_items" USING btree ("catalog_revision_id","offer_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revision_items_revision_price_uidx" ON "billing_catalog_revision_items" USING btree ("catalog_revision_id","billing_price_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revisions_active_provider_uidx" ON "billing_catalog_revisions" USING btree ("checkout_provider") WHERE "billing_catalog_revisions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_provider_session_uidx" ON "billing_checkout_attempts" USING btree ("provider","provider_checkout_session_id") WHERE "billing_checkout_attempts"."provider_checkout_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_idempotency_uidx" ON "billing_checkout_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_entity_nonterminal_uidx" ON "billing_checkout_attempts" USING btree ("billable_entity_id") WHERE "billing_checkout_attempts"."status" IN ('creating', 'open');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_change_attempts_idempotency_uidx" ON "billing_plan_change_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_change_attempts_entity_nonterminal_uidx" ON "billing_plan_change_attempts" USING btree ("billable_entity_id") WHERE "billing_plan_change_attempts"."status" IN ('creating', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_price_entries_provider_product_uidx" ON "billing_price_entries" USING btree ("provider","provider_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_price_entries_offer_key_idx" ON "billing_price_entries" USING btree ("offer_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_provider_payer_uidx" ON "billing_provider_customers" USING btree ("provider","payer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_provider_customer_uidx" ON "billing_provider_customers" USING btree ("provider","provider_customer_id") WHERE "billing_provider_customers"."provider_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_idempotency_uidx" ON "billing_provider_customers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_checkout_uidx" ON "billing_reconciliation_jobs" USING btree ("checkout_attempt_id") WHERE "billing_reconciliation_jobs"."checkout_attempt_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_plan_change_uidx" ON "billing_reconciliation_jobs" USING btree ("plan_change_attempt_id") WHERE "billing_reconciliation_jobs"."plan_change_attempt_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_subscription_uidx" ON "billing_reconciliation_jobs" USING btree ("subscription_id") WHERE "billing_reconciliation_jobs"."subscription_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_customer_uidx" ON "billing_reconciliation_jobs" USING btree ("provider_customer_id") WHERE "billing_reconciliation_jobs"."provider_customer_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_provider_subscription_uidx" ON "billing_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_entity_source_uidx" ON "billing_subscriptions" USING btree ("billable_entity_id") WHERE "billing_subscriptions"."is_entitlement_source" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_webhook_events_provider_event_uidx" ON "billing_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_webhook_events_queue_idx" ON "billing_webhook_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_trial_claims_user_trial_uidx" ON "billing_trial_claims" USING btree ("user_id","trial_key") WHERE "billing_trial_claims"."status" <> 'released';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_trial_claims_email_trial_uidx" ON "billing_trial_claims" USING btree ("verified_email_fingerprint","trial_key") WHERE "billing_trial_claims"."status" <> 'released';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" IN ('pending_payment', 'active', 'suspended', 'abandoned', 'closed'));
--> statement-breakpoint
-- Application backfill (not emitted by drizzle-kit): existing organisations
-- get a Free plan-state row. New rows use the application UUID generator.
INSERT INTO "billing_plan_states" ("id", "billable_entity_id", "plan", "ramp_stage", "ramp_clean_stage_days", "projection_version")
SELECT md5("organizations"."id"::text || ':billing-plan-state')::uuid,
	"organizations"."id",
	'free',
	0,
	0,
	0
FROM "organizations"
WHERE NOT EXISTS (
	SELECT 1
	FROM "billing_plan_states" AS "existing"
	WHERE "existing"."billable_entity_id" = "organizations"."id"
);