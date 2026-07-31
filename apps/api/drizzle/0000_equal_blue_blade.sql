CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_custom_field_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_type" text NOT NULL,
	"value_text" text,
	"value_number" double precision,
	"value_boolean" boolean,
	"value_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"contact_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"subscribed" boolean DEFAULT true NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contacts_contact_id_unique" UNIQUE("contact_id"),
	CONSTRAINT "contacts_unsubscribe_token_unique" UNIQUE("unsubscribe_token"),
	CONSTRAINT "contacts_contact_id_check" CHECK ("contacts"."contact_id" ~ '^cnt_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_delivery_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"team_id" uuid,
	"outbound_message_id" uuid,
	"provider" text NOT NULL,
	"provider_event_key" text NOT NULL,
	"provider_message_id" text,
	"recipient_email" text,
	"normalized_recipient" text,
	"event_type" text NOT NULL,
	"bounce_class" text,
	"smtp_code" integer,
	"enhanced_status_code" text,
	"reason" text,
	"remote_mta" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "email_delivery_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "email_delivery_events_event_id_check" CHECK ("email_delivery_events"."event_id" ~ '^evt_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"action" text NOT NULL,
	"link" text,
	"link_index" integer,
	"bounce_type" text,
	"bounce_reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppression_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"suppression_id" uuid NOT NULL,
	"source_event_id" uuid,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"suppression_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"recipient_email" text,
	"normalized_recipient" text,
	"recipient_hash" text NOT NULL,
	"hash_key_version" integer NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"first_suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_suppressions_suppression_id_unique" UNIQUE("suppression_id"),
	CONSTRAINT "email_suppressions_suppression_id_check" CHECK ("email_suppressions"."suppression_id" ~ '^sup_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text DEFAULT 'marketing' NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "email_templates_template_id_unique" UNIQUE("template_id"),
	CONSTRAINT "email_templates_template_id_check" CHECK ("email_templates"."template_id" ~ '^tpl_'),
	CONSTRAINT "email_templates_purpose_check" CHECK ("email_templates"."purpose" in ('marketing', 'transactional'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_config_team_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"esp_config_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"drain_until" timestamp with time zone,
	"from_name" text,
	"reply_to" text,
	"daily_limit" integer,
	"monthly_limit" integer,
	"created_by_type" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "esp_config_team_grants_grant_id_unique" UNIQUE("grant_id"),
	CONSTRAINT "esp_config_team_grants_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "esp_config_team_grants_id_team_esp_unique" UNIQUE("id","team_id","esp_config_id"),
	CONSTRAINT "esp_config_team_grants_public_id_check" CHECK ("esp_config_team_grants"."grant_id" ~ '^egr_'),
	CONSTRAINT "esp_config_team_grants_status_check" CHECK ("esp_config_team_grants"."status" IN ('active', 'draining', 'suspended', 'revoked')),
	CONSTRAINT "esp_config_team_grants_limit_check" CHECK (("esp_config_team_grants"."daily_limit" IS NULL OR "esp_config_team_grants"."daily_limit" >= 0)
                AND ("esp_config_team_grants"."monthly_limit" IS NULL OR "esp_config_team_grants"."monthly_limit" >= 0)),
	CONSTRAINT "esp_config_team_grants_created_by_type_check" CHECK ("esp_config_team_grants"."created_by_type" IN ('user', 'organization_key', 'system'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"esp_id" text NOT NULL,
	"owner_scope" text NOT NULL,
	"organization_id" uuid,
	"team_id" uuid,
	"name" text NOT NULL,
	"provider" text DEFAULT 'smtp' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text,
	"encrypted_secret" text,
	"from_name" text,
	"from_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_status" text,
	"last_test_error" text,
	"activated_at" timestamp with time zone,
	"drain_until" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "esp_configs_esp_id_unique" UNIQUE("esp_id"),
	CONSTRAINT "esp_configs_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "esp_configs_id_team_id_unique" UNIQUE("id","team_id"),
	CONSTRAINT "esp_configs_esp_id_check" CHECK ("esp_configs"."esp_id" ~ '^esp_'),
	CONSTRAINT "esp_configs_owner_check" CHECK (("esp_configs"."owner_scope" = 'organization' AND "esp_configs"."organization_id" IS NOT NULL AND "esp_configs"."team_id" IS NULL)
                OR ("esp_configs"."owner_scope" = 'team' AND "esp_configs"."organization_id" IS NULL AND "esp_configs"."team_id" IS NOT NULL)),
	CONSTRAINT "esp_configs_status_check" CHECK ("esp_configs"."status" IN ('draft', 'active', 'suspended', 'draining', 'retired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_feedback_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"owner_scope" text NOT NULL,
	"organization_id" uuid,
	"team_id" uuid,
	"esp_config_id" uuid,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"previous_encrypted_credentials" text,
	"previous_credential_expires_at" timestamp with time zone,
	"expected_topic_arn" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_received_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "esp_feedback_connections_connection_id_unique" UNIQUE("connection_id"),
	CONSTRAINT "esp_feedback_connections_connection_id_check" CHECK ("esp_feedback_connections"."connection_id" ~ '^whc_'),
	CONSTRAINT "esp_feedback_connections_owner_check" CHECK ((
                "esp_feedback_connections"."owner_scope" = 'organization'
                AND "esp_feedback_connections"."organization_id" IS NOT NULL
                AND "esp_feedback_connections"."team_id" IS NULL
            ) OR (
                "esp_feedback_connections"."owner_scope" = 'team'
                AND "esp_feedback_connections"."organization_id" IS NULL
                AND "esp_feedback_connections"."team_id" IS NOT NULL
            ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esp_webhook_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"team_id" uuid,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"body_sha256" text NOT NULL,
	"encrypted_payload" text,
	"safe_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "esp_webhook_receipts_receipt_id_unique" UNIQUE("receipt_id"),
	CONSTRAINT "esp_webhook_receipts_receipt_id_check" CHECK ("esp_webhook_receipts"."receipt_id" ~ '^whr_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_dispatch_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"queue_name" text NOT NULL,
	"job_name" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_dispatch_outbox_dispatch_id_unique" UNIQUE("dispatch_id"),
	CONSTRAINT "mail_dispatch_outbox_outbound_message_id_unique" UNIQUE("outbound_message_id"),
	CONSTRAINT "mail_dispatch_outbox_dispatch_id_check" CHECK ("mail_dispatch_outbox"."dispatch_id" ~ '^mdj_'),
	CONSTRAINT "mail_dispatch_outbox_state_check" CHECK ("mail_dispatch_outbox"."state" IN ('pending', 'publishing', 'published', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"media_lit_id" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"file_name" text,
	"mime_type" text,
	"size" integer,
	"width" integer,
	"height" integer,
	"alt" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "media_media_id_unique" UNIQUE("media_id"),
	CONSTRAINT "media_media_id_check" CHECK ("media"."media_id" ~ '^med_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_internal_id" uuid NOT NULL,
	"resource_public_id" text NOT NULL,
	"parent_resource_internal_id" uuid,
	"parent_resource_public_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"token_endpoint_auth_method" text,
	"grant_types" text[],
	"response_types" text[],
	"public" boolean,
	"type" text,
	"require_pkce" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_post_login_team_selections" (
	"session_id" text PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ongoing_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"next_email_scheduled_time" bigint NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"sent_email_ids" text[] DEFAULT '{}' NOT NULL,
	"processing_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_api_key_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_api_keys_organization_api_key_id_unique" UNIQUE("organization_api_key_id"),
	CONSTRAINT "organization_api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "organization_api_keys_public_id_check" CHECK ("organization_api_keys"."organization_api_key_id" ~ '^oak_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"team_id" uuid,
	"esp_config_id" uuid,
	"esp_grant_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_delivery_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"default_esp_config_id" uuid,
	"auto_grant_default_esp" boolean DEFAULT false NOT NULL,
	"default_daily_limit" integer,
	"default_monthly_limit" integer,
	"aggregate_daily_limit" integer,
	"aggregate_monthly_limit" integer,
	"team_esp_enabled_by_default" boolean DEFAULT true NOT NULL,
	"team_can_change_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_delivery_policies_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "organization_delivery_policies_limit_check" CHECK (("organization_delivery_policies"."default_daily_limit" IS NULL OR "organization_delivery_policies"."default_daily_limit" >= 0)
                AND ("organization_delivery_policies"."default_monthly_limit" IS NULL OR "organization_delivery_policies"."default_monthly_limit" >= 0)
                AND ("organization_delivery_policies"."aggregate_daily_limit" IS NULL OR "organization_delivery_policies"."aggregate_daily_limit" >= 0)
                AND ("organization_delivery_policies"."aggregate_monthly_limit" IS NULL OR "organization_delivery_policies"."aggregate_monthly_limit" >= 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_esp_quota_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reservation_id" text NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"day_period_start" timestamp with time zone NOT NULL,
	"month_period_start" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "organization_esp_quota_reservations_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "organization_esp_quota_reservations_outbound_message_id_unique" UNIQUE("outbound_message_id"),
	CONSTRAINT "organization_esp_quota_reservations_reservation_id_check" CHECK ("organization_esp_quota_reservations"."reservation_id" ~ '^qrs_'),
	CONSTRAINT "organization_esp_quota_reservations_state_check" CHECK ("organization_esp_quota_reservations"."state" IN ('reserved', 'committed', 'released'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_esp_usage_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bucket_scope" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"grant_id" uuid,
	"period_type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_esp_usage_buckets_scope_check" CHECK ((
                "organization_esp_usage_buckets"."bucket_scope" = 'grant' AND "organization_esp_usage_buckets"."grant_id" IS NOT NULL
            ) OR (
                "organization_esp_usage_buckets"."bucket_scope" = 'organization' AND "organization_esp_usage_buckets"."grant_id" IS NULL
            )),
	CONSTRAINT "organization_esp_usage_buckets_period_check" CHECK ("organization_esp_usage_buckets"."period_type" IN ('day', 'month')),
	CONSTRAINT "organization_esp_usage_buckets_count_check" CHECK ("organization_esp_usage_buckets"."reserved_count" >= 0 AND "organization_esp_usage_buckets"."accepted_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "organizations_organization_id_check" CHECK ("organizations"."organization_id" ~ '^org_'),
	CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" IN ('active', 'suspended', 'closed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"delivery_source_type" text NOT NULL,
	"esp_config_id" uuid,
	"esp_grant_id" uuid,
	"feedback_connection_id" uuid,
	"source_type" text NOT NULL,
	"submission_key" text,
	"campaign_delivery_id" uuid,
	"transactional_email_id" uuid,
	"recipient_email" text NOT NULL,
	"normalized_recipient" text NOT NULL,
	"provider" text,
	"rfc_message_id" text,
	"provider_message_id" text,
	"delivery_status" text DEFAULT 'queued' NOT NULL,
	"feedback_status" text DEFAULT 'none' NOT NULL,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "outbound_messages_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "outbound_messages_submission_key_unique" UNIQUE("submission_key"),
	CONSTRAINT "outbound_messages_message_id_check" CHECK ("outbound_messages"."message_id" ~ '^msg_'),
	CONSTRAINT "outbound_messages_delivery_pin_check" CHECK ((
                "outbound_messages"."delivery_source_type" = 'team'
                AND "outbound_messages"."esp_config_id" IS NOT NULL
                AND "outbound_messages"."esp_grant_id" IS NULL
            ) OR (
                "outbound_messages"."delivery_source_type" = 'organization'
                AND "outbound_messages"."esp_config_id" IS NOT NULL
                AND "outbound_messages"."esp_grant_id" IS NOT NULL
            ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"event" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"event_date_in_millis" bigint,
	"event_data" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "rules_rule_id_unique" UNIQUE("rule_id"),
	CONSTRAINT "rules_rule_id_check" CHECK ("rules"."rule_id" ~ '^rule_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"segment_id" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "segments_segment_id_unique" UNIQUE("segment_id"),
	CONSTRAINT "segments_segment_id_check" CHECK ("segments"."segment_id" ~ '^seg_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence_id" uuid NOT NULL,
	"email_id" text NOT NULL,
	"subject" text NOT NULL,
	"content" jsonb NOT NULL,
	"delay_in_millis" bigint DEFAULT 86400000 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"template_id" text,
	"action_type" text,
	"action_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sequence_emails_email_id_check" CHECK ("sequence_emails"."email_id" ~ '^email_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_source_intent" jsonb,
	"delivery_source_type" text,
	"outbox_id" uuid,
	"esp_grant_id" uuid,
	"trigger_type" text,
	"trigger_data" text,
	"filter" jsonb,
	"exclude_filter" jsonb,
	"emails_order" text[] DEFAULT '{}' NOT NULL,
	"entrants" text[] DEFAULT '{}' NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sequences_sequence_id_unique" UNIQUE("sequence_id"),
	CONSTRAINT "sequences_sequence_id_check" CHECK ("sequences"."sequence_id" ~ '^seq_'),
	CONSTRAINT "sequences_delivery_pin_check" CHECK ((
                "sequences"."delivery_source_type" IS NULL
                AND "sequences"."outbox_id" IS NULL
                AND "sequences"."esp_grant_id" IS NULL
            ) OR (
                "sequences"."delivery_source_type" = 'team'
                AND "sequences"."outbox_id" IS NOT NULL
                AND "sequences"."esp_grant_id" IS NULL
            ) OR (
                "sequences"."delivery_source_type" = 'organization'
                AND "sequences"."outbox_id" IS NOT NULL
                AND "sequences"."esp_grant_id" IS NOT NULL
            ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"mailing_address" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "settings_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_api_key_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_type" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_api_keys_team_api_key_id_unique" UNIQUE("team_api_key_id"),
	CONSTRAINT "team_api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "team_api_keys_public_id_check" CHECK ("team_api_keys"."team_api_key_id" ~ '^tak_'),
	CONSTRAINT "team_api_keys_created_by_type_check" CHECK ("team_api_keys"."created_by_type" IN ('user', 'organization_key', 'system'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_delivery_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"team_esp_enabled" boolean DEFAULT true NOT NULL,
	"team_can_change_default" boolean DEFAULT true NOT NULL,
	"default_source" text,
	"default_team_esp_config_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_delivery_settings_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "team_delivery_settings_default_source_check" CHECK ("team_delivery_settings"."default_source" IS NULL OR "team_delivery_settings"."default_source" IN ('organization', 'team'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_role_check" CHECK ("team_members"."role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_id" text,
	"provisioning_request_hash" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "teams_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "teams_team_id_check" CHECK ("teams"."team_id" ~ '^team_'),
	CONSTRAINT "teams_status_check" CHECK ("teams"."status" IN ('active', 'sending_suspended', 'archived'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactional_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"txe_id" text NOT NULL,
	"delivery_source_type" text NOT NULL,
	"outbox_id" uuid,
	"esp_grant_id" uuid,
	"to_email" text NOT NULL,
	"from_email" text,
	"reply_to" text,
	"subject" text NOT NULL,
	"template_id" text,
	"html" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headers" jsonb,
	"contact_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"processing_started_at" timestamp with time zone,
	"error" text,
	"idempotency_key" text,
	"track_opens" boolean DEFAULT false NOT NULL,
	"track_clicks" boolean DEFAULT false NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "transactional_emails_txe_id_unique" UNIQUE("txe_id"),
	CONSTRAINT "transactional_emails_txe_id_check" CHECK ("transactional_emails"."txe_id" ~ '^txe_'),
	CONSTRAINT "transactional_emails_delivery_pin_check" CHECK ((
                "transactional_emails"."delivery_source_type" = 'team'
                AND "transactional_emails"."outbox_id" IS NOT NULL
                AND "transactional_emails"."esp_grant_id" IS NULL
            ) OR (
                "transactional_emails"."delivery_source_type" = 'organization'
                AND "transactional_emails"."outbox_id" IS NOT NULL
                AND "transactional_emails"."esp_grant_id" IS NOT NULL
            ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"default_organization_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_email_id_sequence_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_receipt_id_esp_webhook_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."esp_webhook_receipts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_sequence_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."sequence_emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_suppression_id_email_suppressions_id_fk" FOREIGN KEY ("suppression_id") REFERENCES "public"."email_suppressions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_source_event_id_email_delivery_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_delivery_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppression_actions" ADD CONSTRAINT "email_suppression_actions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_source_event_id_email_delivery_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_delivery_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_config_team_grants" ADD CONSTRAINT "esp_config_team_grants_team_organization_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."teams"("id","organization_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_config_team_grants" ADD CONSTRAINT "esp_config_team_grants_esp_organization_fk" FOREIGN KEY ("esp_config_id","organization_id") REFERENCES "public"."esp_configs"("id","organization_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_configs" ADD CONSTRAINT "esp_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_configs" ADD CONSTRAINT "esp_configs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_feedback_connections" ADD CONSTRAINT "esp_feedback_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_feedback_connections" ADD CONSTRAINT "esp_feedback_connections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_feedback_connections" ADD CONSTRAINT "esp_feedback_connections_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_webhook_receipts" ADD CONSTRAINT "esp_webhook_receipts_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esp_webhook_receipts" ADD CONSTRAINT "esp_webhook_receipts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_dispatch_outbox" ADD CONSTRAINT "mail_dispatch_outbox_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_references" ADD CONSTRAINT "media_references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_references" ADD CONSTRAINT "media_references_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_post_login_team_selections" ADD CONSTRAINT "oauth_post_login_team_selections_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_post_login_team_selections" ADD CONSTRAINT "oauth_post_login_team_selections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ongoing_sequences" ADD CONSTRAINT "ongoing_sequences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_audit_events" ADD CONSTRAINT "organization_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_delivery_policies" ADD CONSTRAINT "organization_delivery_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_delivery_policies" ADD CONSTRAINT "organization_delivery_policies_default_esp_fk" FOREIGN KEY ("default_esp_config_id","organization_id") REFERENCES "public"."esp_configs"("id","organization_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_quota_reservations" ADD CONSTRAINT "organization_esp_quota_reservations_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_quota_reservations" ADD CONSTRAINT "organization_esp_quota_reservations_grant_id_esp_config_team_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."esp_config_team_grants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_quota_reservations" ADD CONSTRAINT "organization_esp_quota_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_quota_reservations" ADD CONSTRAINT "organization_esp_quota_reservations_grant_organization_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."esp_config_team_grants"("id","organization_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_usage_buckets" ADD CONSTRAINT "organization_esp_usage_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_usage_buckets" ADD CONSTRAINT "organization_esp_usage_buckets_grant_id_esp_config_team_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."esp_config_team_grants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_esp_usage_buckets" ADD CONSTRAINT "organization_esp_usage_buckets_grant_organization_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."esp_config_team_grants"("id","organization_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_esp_config_id_esp_configs_id_fk" FOREIGN KEY ("esp_config_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_esp_grant_id_esp_config_team_grants_id_fk" FOREIGN KEY ("esp_grant_id") REFERENCES "public"."esp_config_team_grants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_feedback_connection_id_esp_feedback_connections_id_fk" FOREIGN KEY ("feedback_connection_id") REFERENCES "public"."esp_feedback_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_delivery_id_email_deliveries_id_fk" FOREIGN KEY ("campaign_delivery_id") REFERENCES "public"."email_deliveries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_transactional_email_id_transactional_emails_id_fk" FOREIGN KEY ("transactional_email_id") REFERENCES "public"."transactional_emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segments" ADD CONSTRAINT "segments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_emails" ADD CONSTRAINT "sequence_emails_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_outbox_id_esp_configs_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequences" ADD CONSTRAINT "sequences_esp_grant_id_esp_config_team_grants_id_fk" FOREIGN KEY ("esp_grant_id") REFERENCES "public"."esp_config_team_grants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_api_keys" ADD CONSTRAINT "team_api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_delivery_settings" ADD CONSTRAINT "team_delivery_settings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_delivery_settings" ADD CONSTRAINT "team_delivery_settings_default_team_esp_fk" FOREIGN KEY ("default_team_esp_config_id","team_id") REFERENCES "public"."esp_configs"("id","team_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_outbox_id_esp_configs_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."esp_configs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_esp_grant_id_esp_config_team_grants_id_fk" FOREIGN KEY ("esp_grant_id") REFERENCES "public"."esp_config_team_grants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactional_emails" ADD CONSTRAINT "transactional_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_default_organization_id_organizations_id_fk" FOREIGN KEY ("default_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_contact_key_idx" ON "contact_custom_field_values" USING btree ("team_id","contact_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_text_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_number_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_boolean_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_boolean");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_custom_field_values_date_lookup_idx" ON "contact_custom_field_values" USING btree ("team_id","key","value_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_team_id_email_idx" ON "contacts" USING btree ("team_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_delivery_events_connection_id_provider_event_key_idx" ON "email_delivery_events" USING btree ("connection_id","provider_event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_team_id_occurred_at_idx" ON "email_delivery_events" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_outbound_message_id_idx" ON "email_delivery_events" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_suppression_actions_suppression_id_created_at_idx" ON "email_suppression_actions" USING btree ("suppression_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_team_id_recipient_hash_idx" ON "email_suppressions" USING btree ("team_id","recipient_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_suppressions_team_id_active_idx" ON "email_suppressions" USING btree ("team_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_team_id_title_idx" ON "email_templates" USING btree ("team_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esp_config_team_grants_non_revoked_team_idx" ON "esp_config_team_grants" USING btree ("team_id") WHERE "esp_config_team_grants"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_configs_organization_id_idx" ON "esp_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_configs_team_id_idx" ON "esp_configs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_feedback_connections_team_id_idx" ON "esp_feedback_connections" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esp_feedback_connections_esp_config_active_idx" ON "esp_feedback_connections" USING btree ("esp_config_id") WHERE "esp_feedback_connections"."esp_config_id" is not null and "esp_feedback_connections"."status" not in ('retiring', 'disabled');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_webhook_receipts_status_next_attempt_idx" ON "esp_webhook_receipts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esp_webhook_receipts_connection_id_provider_request_id_idx" ON "esp_webhook_receipts" USING btree ("connection_id","provider_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_dispatch_outbox_due_idx" ON "mail_dispatch_outbox" USING btree ("state","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_team_id_media_lit_id_idx" ON "media" USING btree ("team_id","media_lit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_team_id_created_at_idx" ON "media" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_references_resource_idx" ON "media_references" USING btree ("team_id","resource_type","resource_internal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_references_media_id_idx" ON "media_references" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_references_resource_media_idx" ON "media_references" USING btree ("team_id","resource_type","resource_internal_id","media_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_access_token_client_id_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_access_token_session_id_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_access_token_user_id_idx" ON "oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_access_token_refresh_id_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_client_user_id_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_consent_client_id_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_consent_user_id_idx" ON "oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_token_client_id_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_token_user_id_idx" ON "oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ongoing_sequences_sequence_id_contact_id_idx" ON "ongoing_sequences" USING btree ("sequence_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ongoing_sequences_next_email_scheduled_time_idx" ON "ongoing_sequences" USING btree ("next_email_scheduled_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_api_keys_organization_id_idx" ON "organization_api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_audit_events_organization_id_created_at_idx" ON "organization_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_audit_events_team_id_created_at_idx" ON "organization_audit_events" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_esp_usage_buckets_grant_period_idx" ON "organization_esp_usage_buckets" USING btree ("grant_id","period_type","period_start") WHERE "organization_esp_usage_buckets"."grant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_esp_usage_buckets_organization_period_idx" ON "organization_esp_usage_buckets" USING btree ("organization_id","period_type","period_start") WHERE "organization_esp_usage_buckets"."bucket_scope" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_id_user_id_idx" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_team_id_created_at_idx" ON "outbound_messages" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_connection_provider_msg_idx" ON "outbound_messages" USING btree ("feedback_connection_id","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_team_id_recipient_created_at_idx" ON "outbound_messages" USING btree ("team_id","normalized_recipient","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "segments_team_id_name_idx" ON "segments" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_emails_sequence_id_email_id_idx" ON "sequence_emails" USING btree ("sequence_id","email_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_api_keys_team_id_idx" ON "team_api_keys" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_id_user_id_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_organization_id_external_id_idx" ON "teams" USING btree ("organization_id","external_id") WHERE "teams"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transactional_emails_team_id_idempotency_key_idx" ON "transactional_emails" USING btree ("team_id","idempotency_key") WHERE "transactional_emails"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactional_emails_team_id_created_at_idx" ON "transactional_emails" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactional_emails_team_id_status_idx" ON "transactional_emails" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_verification_identifier_idx" ON "verification" USING btree ("identifier");
--> statement-breakpoint
-- Structural delivery-pin validation is intentionally in PostgreSQL as well
-- as the application resolver: direct SQL or a future code path cannot pin a
-- team to another team's ESP or to an unrelated organization grant.
CREATE OR REPLACE FUNCTION sendlit_assert_delivery_pin(
    p_team_id uuid,
    p_source_type text,
    p_esp_config_id uuid,
    p_esp_grant_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_source_type = 'team' THEN
        IF p_esp_grant_id IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM esp_configs e
            WHERE e.id = p_esp_config_id
              AND e.owner_scope = 'team'
              AND e.team_id = p_team_id
        ) THEN
            RAISE EXCEPTION 'invalid team delivery pin';
        END IF;
    ELSIF p_source_type = 'organization' THEN
        IF p_esp_grant_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM esp_config_team_grants g
            JOIN esp_configs e ON e.id = g.esp_config_id
            WHERE g.id = p_esp_grant_id
              AND g.team_id = p_team_id
              AND g.esp_config_id = p_esp_config_id
              AND e.owner_scope = 'organization'
              AND e.organization_id = g.organization_id
        ) THEN
            RAISE EXCEPTION 'invalid organization delivery pin';
        END IF;
    ELSE
        RAISE EXCEPTION 'invalid delivery source type';
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sendlit_check_sequence_delivery_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.delivery_source_type IS NOT NULL THEN
        PERFORM sendlit_assert_delivery_pin(NEW.team_id, NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.delivery_source_type IS NOT NULL
       AND (OLD.delivery_source_type, OLD.outbox_id, OLD.esp_grant_id)
           IS DISTINCT FROM (NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id) THEN
        RAISE EXCEPTION 'sequence delivery pin is immutable';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sendlit_check_sequence_delivery_pin_trigger
BEFORE INSERT OR UPDATE OF delivery_source_type, outbox_id, esp_grant_id ON sequences
FOR EACH ROW EXECUTE FUNCTION sendlit_check_sequence_delivery_pin();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sendlit_check_transactional_delivery_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM sendlit_assert_delivery_pin(NEW.team_id, NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id);
    IF TG_OP = 'UPDATE' AND (OLD.delivery_source_type, OLD.outbox_id, OLD.esp_grant_id)
       IS DISTINCT FROM (NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id) THEN
        RAISE EXCEPTION 'transactional delivery pin is immutable';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sendlit_check_transactional_delivery_pin_trigger
BEFORE INSERT OR UPDATE OF delivery_source_type, outbox_id, esp_grant_id ON transactional_emails
FOR EACH ROW EXECUTE FUNCTION sendlit_check_transactional_delivery_pin();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sendlit_check_outbound_delivery_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM sendlit_assert_delivery_pin(NEW.team_id, NEW.delivery_source_type, NEW.esp_config_id, NEW.esp_grant_id);
    IF TG_OP = 'UPDATE' AND (OLD.delivery_source_type, OLD.esp_config_id, OLD.esp_grant_id)
       IS DISTINCT FROM (NEW.delivery_source_type, NEW.esp_config_id, NEW.esp_grant_id) THEN
        RAISE EXCEPTION 'outbound delivery pin is immutable';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sendlit_check_outbound_delivery_pin_trigger
BEFORE INSERT OR UPDATE OF delivery_source_type, esp_config_id, esp_grant_id ON outbound_messages
FOR EACH ROW EXECUTE FUNCTION sendlit_check_outbound_delivery_pin();
--> statement-breakpoint
-- A reservation may only charge the exact organization grant pinned on its
-- outbound ledger row; this prevents a direct write from moving quota between
-- teams or organization ESPs.
CREATE OR REPLACE FUNCTION sendlit_check_quota_reservation_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM outbound_messages m
        WHERE m.id = NEW.outbound_message_id
          AND m.delivery_source_type = 'organization'
          AND m.esp_grant_id = NEW.grant_id
    ) THEN
        RAISE EXCEPTION 'quota reservation does not match outbound delivery pin';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sendlit_check_quota_reservation_pin_trigger
BEFORE INSERT OR UPDATE OF outbound_message_id, grant_id ON organization_esp_quota_reservations
FOR EACH ROW EXECUTE FUNCTION sendlit_check_quota_reservation_pin();
