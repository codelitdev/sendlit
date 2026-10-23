-- Revised hosted plans (#60): Pro drops from 5 to 3 teams and Business from
-- 25 to 15. Organizations already on those plans with more teams keep what
-- they have through a teams limit override (ADR 0002). Data only.
INSERT INTO "organization_plan_policies" ("id", "organization_id", "teams_limit_override")
SELECT gen_random_uuid(), s."billable_entity_id", COUNT(t."id")::integer
FROM "billing_subscriptions" s
JOIN "teams" t
  ON t."organization_id" = s."billable_entity_id"
 AND t."status" IN ('active', 'sending_suspended')
WHERE s."is_entitlement_source" = true
  AND s."status" IN ('trialing', 'active', 'past_due')
  AND s."plan" IN ('pro', 'business')
GROUP BY s."billable_entity_id", s."plan"
HAVING (s."plan" = 'pro' AND COUNT(t."id") > 3)
    OR (s."plan" = 'business' AND COUNT(t."id") > 15)
ON CONFLICT ("organization_id") DO UPDATE
SET "teams_limit_override" = GREATEST(
      COALESCE("organization_plan_policies"."teams_limit_override", 0),
      EXCLUDED."teams_limit_override"
    ),
    "updated_at" = now();
