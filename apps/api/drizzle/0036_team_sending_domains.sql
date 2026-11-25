ALTER TABLE "esp_config_team_grants" ADD COLUMN "from_email" text;--> statement-breakpoint
ALTER TABLE "esp_config_team_grants" ADD COLUMN "sending_domain_id" uuid;--> statement-breakpoint
ALTER TABLE "esp_configs" ADD COLUMN "encrypted_management_secret" text;--> statement-breakpoint
ALTER TABLE "organization_delivery_policies" ADD COLUMN "require_team_sending_domain" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_delivery_policies" ADD COLUMN "shared_domain_monthly_limit" integer;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "esp_config_id" uuid;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "dkim_status" text;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "dmarc_status" text;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "dns_records" jsonb;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD COLUMN "auth_failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "esp_config_team_grants" ADD CONSTRAINT "esp_config_team_grants_sending_domain_id_sending_domains_id_fk" FOREIGN KEY ("sending_domain_id") REFERENCES "public"."sending_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_live_team_idx" ON "sending_domains" USING btree ("team_id") WHERE "sending_domains"."team_id" IS NOT NULL AND "sending_domains"."status" <> 'revoked';--> statement-breakpoint
ALTER TABLE "organization_delivery_policies" ADD CONSTRAINT "organization_delivery_policies_require_team_domain_check" CHECK ("organization_delivery_policies"."require_team_sending_domain" IN ('off', 'marketing', 'all'));--> statement-breakpoint
ALTER TABLE "organization_delivery_policies" ADD CONSTRAINT "organization_delivery_policies_shared_domain_limit_check" CHECK ("organization_delivery_policies"."shared_domain_monthly_limit" IS NULL OR "organization_delivery_policies"."shared_domain_monthly_limit" >= 0);