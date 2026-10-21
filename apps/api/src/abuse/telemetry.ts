import { captureError, captureEvent } from "../observability";
import logger from "../services/log";
import { sharedRedis } from "../services/redis-client";

/** Hosted abuse-control events, as PostHog product events. Properties must
 * be on `PROPERTY_ALLOWLIST` (`observability/instance.ts`); never email
 * addresses or IPs. */
export type AbuseEvent =
  | "signup_blocked"
  | "content_scanned"
  | "team_paused_for_review"
  | "abuse_flag_raised"
  | "abuse_flag_resolved"
  | "organization_sending_suspended"
  | "organization_sending_unsuspended"
  | "marketing_send_paced";

/**
 * Records an abuse-control decision as a PostHog event and a log line (which
 * PostHog Logs receives too). Organization-level events carry
 * `organization_id`; their subject is the team when there is one.
 */
export function recordAbuseEvent(
  event: AbuseEvent,
  input: {
    source: string;
    teamId?: string | null;
    organizationId?: string | null;
    properties?: Record<string, string | number | boolean>;
  },
): void {
  const properties = {
    ...input.properties,
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
  };
  // Routine outcomes log at info; decisions against a customer at warn.
  const routine = event === "content_scanned" || event === "marketing_send_paced";
  logger[routine ? "info" : "warn"](
    { abuse_event: event, team_id: input.teamId ?? undefined, ...properties },
    `abuse: ${event}`,
  );
  captureEvent({
    event,
    source: input.source,
    teamId: input.teamId ?? undefined,
    properties,
  });
}

/**
 * A new account's marketing send was deferred by the daily ramp or hourly
 * pacing. Every recipient is deferred separately, so this is recorded at most
 * once per sequence per UTC hour.
 */
export async function recordPacedSend(input: {
  teamId: string;
  organizationId: string;
  sequenceId: string;
  reason: string;
}): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13);
  try {
    const first = await sharedRedis().set(
      `sendlit:abuse:paced:${input.sequenceId}:${hour}`,
      "1",
      "EX",
      3_600,
      "NX",
    );
    if (first !== "OK") return;
  } catch (error) {
    captureError({ error, source: "abuse.pacing_event", severity: "warning" });
    return;
  }
  recordAbuseEvent("marketing_send_paced", {
    source: "abuse.pacing",
    teamId: input.teamId,
    organizationId: input.organizationId,
    properties: { reason: input.reason, sequence_id: input.sequenceId },
  });
}
