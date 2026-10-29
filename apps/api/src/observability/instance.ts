import {
  type CaptureClient,
  createObservability,
  type Observability,
} from "@codelitdev/observability";

// The process-wide observability instances (see @codelitdev/observability).
// Structured logs always go to stdout. With POSTHOG_API_KEY set, errors and
// product events are captured to PostHog and every log line is also shipped
// to PostHog's OTLP logs endpoint. Without it, capture calls are no-ops.

const SERVICE_NAME = "sendlit:api";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_LOGS_PATH = "/i/v1/logs";
const DEFAULT_PER_SOURCE_CAP = 100;

/** Properties allowed on captured errors and events. Anything else is dropped. */
const PROPERTY_ALLOWLIST = new Set([
  "team_id",
  "user_id",
  "contact_id",
  "sequence_id",
  "sequence_type",
  "sequence_status",
  "ongoing_sequence_id",
  "template_id",
  "segment_id",
  "email_id",
  "event_type",
  "action_type",
  "provider",
  "has_password",
  "has_from_email",
  "has_username",
  "secure",
  "port",
  "recipients_count",
  "link_index",
  "job_id",
  "job_name",
  "queue_name",
  "failed_reason",
  "attempts_made",
  "path",
  "method",
  "error_code",
  "response_code",
  "route",
  "worker_name",
  "alert_code",
  "billing_alert",
  "age_ms",
  "count",
  // Hosted abuse controls (abuse/telemetry.ts): codes and internal ids only.
  "organization_id",
  "form_id",
  "kind",
  "severity",
  "verdict",
  "reason",
  "outcome",
  "scan_mode",
  // Custom events (docs/custom_events.md#observability). Event names and
  // properties are customer-defined and never sent.
  "duplicate",
  "contact_created",
  "backfill",
  "stale",
  "sequences_enrolled",
  "event_source",
  "definition_origin",
  // Transactional email: already sent, were missing from the allowlist.
  "txe_id",
  "delivery_source",
  // Organization deletion (organization/delete.ts): counts only.
  "teams_count",
  "media_failed_count",
  // Media cleanup on resource deletes (media/queries.ts deleteOrphanedMedia).
  "media_deleted_count",
  // Bulk contact deletion (contacts/bulk-delete.ts): counts only.
  "suppressed_count",
]);

/** Allowlisted keys that hold opaque record ids. They skip the package's
 * long-token mask, which would otherwise hide every UUID. */
const IDENTIFIER_KEYS = new Set([
  "team_id",
  "user_id",
  "contact_id",
  "sequence_id",
  "ongoing_sequence_id",
  "template_id",
  "segment_id",
  "email_id",
  "job_id",
  "organization_id",
  "form_id",
  "txe_id",
]);

/**
 * `purpose: "events"` builds the instance for product analytics. The package
 * dedupes and rate-caps captures per source, which suits errors but would drop
 * all but the first `email_sent` per team per minute, so the events instance
 * turns both off and ships no logs.
 */
export function createSendLitObservability(
  env: NodeJS.ProcessEnv = process.env,
  options: { client?: CaptureClient; purpose?: "errors" | "events" } = {},
): Observability {
  const forEvents = options.purpose === "events";
  const apiKey = env.POSTHOG_API_KEY?.trim();
  const host = (env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST).trim().replace(/\/+$/, "");
  const perSourceCap = Number.parseInt(
    env.POSTHOG_ERROR_CAP_PER_SOURCE_PER_MINUTE || "",
    10,
  );
  return createObservability({
    serviceName: SERVICE_NAME,
    environment: env.DEPLOY_ENV || env.NODE_ENV || "unknown",
    ...(apiKey ? { posthog: { apiKey, host, client: options.client } } : {}),
    logs: {
      level: env.LOG_LEVEL || "info",
      ...(apiKey && !forEvents
        ? {
            otlp: {
              endpoint: `${host}${POSTHOG_LOGS_PATH}`,
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          }
        : {}),
    },
    contextPolicy: {
      propertyAllowlist: PROPERTY_ALLOWLIST,
      identifierKeys: IDENTIFIER_KEYS,
    },
    ...(forEvents
      ? { dedupeTtlMs: 0, dedupeMaxKeys: 1, perSourceCap: Number.POSITIVE_INFINITY }
      : {
          perSourceCap:
            Number.isFinite(perSourceCap) && perSourceCap > 0
              ? perSourceCap
              : DEFAULT_PER_SOURCE_CAP,
        }),
  });
}

export const observability = createSendLitObservability();
export const productEvents = createSendLitObservability(process.env, {
  purpose: "events",
});

export const logger = observability.logger;

/** Flush captured errors, events and shipped logs, bounded by `timeoutMs`. */
export async function shutdownObservability(timeoutMs = 2_000) {
  await Promise.all([
    observability.shutdown(timeoutMs),
    productEvents.shutdown(timeoutMs),
  ]);
}
