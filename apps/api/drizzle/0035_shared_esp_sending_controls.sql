CREATE TABLE "shared_esp_sending_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"esp_config_id" uuid NOT NULL,
	"team_id" uuid,
	"status" text DEFAULT 'normal' NOT NULL,
	"reason_code" text,
	"source" text DEFAULT 'automatic' NOT NULL,
	"entered_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"minimum_hold_until" timestamp with time zone,
	"clean_evaluation_days" integer DEFAULT 0 NOT NULL,
	"operator_user_id" text,
	"operator_reason" text,
	"released_at" timestamp with time zone,
	"release_grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_esp_sending_controls_status_check" CHECK ("shared_esp_sending_controls"."status" IN ('normal', 'warned', 'marketing_paused')),
	CONSTRAINT "shared_esp_sending_controls_source_check" CHECK ("shared_esp_sending_controls"."source" IN ('automatic', 'operator')),
	CONSTRAINT "shared_esp_sending_controls_clean_days_check" CHECK ("shared_esp_sending_controls"."clean_evaluation_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shared_esp_sending_controls" ADD CONSTRAINT "shared_esp_sending_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_esp_sending_controls" ADD CONSTRAINT "shared_esp_sending_controls_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_esp_sending_controls" ADD CONSTRAINT "shared_esp_sending_controls_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_esp_sending_controls" ADD CONSTRAINT "shared_esp_sending_controls_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_esp_sending_controls_esp_uidx" ON "shared_esp_sending_controls" USING btree ("esp_config_id") WHERE "shared_esp_sending_controls"."team_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_esp_sending_controls_esp_team_uidx" ON "shared_esp_sending_controls" USING btree ("esp_config_id","team_id") WHERE "shared_esp_sending_controls"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbound_messages_esp_config_id_accepted_at_idx" ON "outbound_messages" USING btree ("esp_config_id","accepted_at") WHERE "outbound_messages"."delivery_source_type" = 'organization';