CREATE OR REPLACE FUNCTION sendlit_check_sequence_delivery_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.delivery_source_type IS NOT NULL THEN
        PERFORM sendlit_assert_delivery_pin(NEW.team_id, NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.delivery_source_type IS NOT NULL
       AND (OLD.delivery_source_type, OLD.outbox_id, OLD.esp_grant_id)
           IS DISTINCT FROM (NEW.delivery_source_type, NEW.outbox_id, NEW.esp_grant_id)
       AND NOT (
           OLD.status IN ('draft', 'paused', 'completed')
           AND NEW.delivery_source_type IS NULL
           AND NEW.outbox_id IS NULL
           AND NEW.esp_grant_id IS NULL
       ) THEN
        RAISE EXCEPTION 'sequence delivery pin is immutable';
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE "outbound_messages" DROP CONSTRAINT "outbound_messages_delivery_pin_check";
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_delivery_pin_check" CHECK (("outbound_messages"."delivery_source_type" = 'team' AND "outbound_messages"."esp_config_id" IS NOT NULL AND "outbound_messages"."esp_grant_id" IS NULL) OR ("outbound_messages"."delivery_source_type" = 'organization' AND "outbound_messages"."esp_config_id" IS NOT NULL AND "outbound_messages"."esp_grant_id" IS NOT NULL) OR ("outbound_messages"."delivery_source_type" IN ('team', 'organization') AND "outbound_messages"."esp_config_id" IS NULL AND "outbound_messages"."esp_grant_id" IS NULL AND "outbound_messages"."delivery_status" <> 'queued'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sendlit_check_outbound_delivery_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.esp_config_id IS NOT NULL THEN
        PERFORM sendlit_assert_delivery_pin(NEW.team_id, NEW.delivery_source_type, NEW.esp_config_id, NEW.esp_grant_id);
    END IF;
    IF TG_OP = 'UPDATE'
       AND (OLD.delivery_source_type, OLD.esp_config_id, OLD.esp_grant_id)
           IS DISTINCT FROM (NEW.delivery_source_type, NEW.esp_config_id, NEW.esp_grant_id)
       AND NOT (
           OLD.delivery_status <> 'queued'
           AND NEW.esp_config_id IS NULL
           AND NEW.esp_grant_id IS NULL
       ) THEN
        RAISE EXCEPTION 'outbound delivery pin is immutable';
    END IF;
    RETURN NEW;
END $$;
