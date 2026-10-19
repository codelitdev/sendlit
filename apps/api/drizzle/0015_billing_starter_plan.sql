ALTER TABLE "billing_checkout_attempts" DROP CONSTRAINT "billing_checkout_attempts_plan_check";--> statement-breakpoint
ALTER TABLE "billing_plan_change_attempts" DROP CONSTRAINT "billing_plan_change_attempts_current_plan_check";--> statement-breakpoint
ALTER TABLE "billing_plan_change_attempts" DROP CONSTRAINT "billing_plan_change_attempts_target_plan_check";--> statement-breakpoint
ALTER TABLE "billing_price_entries" DROP CONSTRAINT "billing_price_entries_plan_check";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "billing_subscriptions_plan_check";--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_plan_check" CHECK ("billing_checkout_attempts"."requested_plan" IN ('starter', 'pro', 'business'));--> statement-breakpoint
ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_current_plan_check" CHECK ("billing_plan_change_attempts"."current_plan" IN ('starter', 'pro', 'business'));--> statement-breakpoint
ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_target_plan_check" CHECK ("billing_plan_change_attempts"."target_plan" IN ('starter', 'pro', 'business'));--> statement-breakpoint
ALTER TABLE "billing_price_entries" ADD CONSTRAINT "billing_price_entries_plan_check" CHECK ("billing_price_entries"."plan" IN ('starter', 'pro', 'business'));--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_check" CHECK ("billing_subscriptions"."plan" IN ('starter', 'pro', 'business'));