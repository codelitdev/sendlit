DROP TABLE "billing_trial_claims" CASCADE;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" DROP COLUMN "pending_team_name";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "plan";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "teams_limit_override";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "contacts_limit_override";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "first_paid_activated_at";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "ramp_stage";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "ramp_clean_stage_days";--> statement-breakpoint
ALTER TABLE "billing_plan_states" DROP COLUMN "ramp_evaluated_at";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" DROP COLUMN "past_due_at";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" DROP COLUMN "grace_ends_at";