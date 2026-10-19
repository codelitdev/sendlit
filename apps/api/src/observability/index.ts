import { observability, productEvents } from "./instance";

export { createSendLitObservability, logger, shutdownObservability } from "./instance";

type Severity = "error" | "warning" | "critical";

const SYSTEM_TEAM_ID = "system";

/** Teams are SendLit's telemetry subject; work outside a team reports as `system`. */
export function getTeamId(teamId?: unknown) {
  if (teamId === null || teamId === undefined) return SYSTEM_TEAM_ID;
  const normalized = String(teamId).trim();
  return normalized || SYSTEM_TEAM_ID;
}

export function captureError({
  error,
  source,
  teamId,
  severity = "error",
  context = {},
}: {
  error: unknown;
  source: string;
  teamId?: unknown;
  severity?: Severity;
  context?: Record<string, unknown>;
}) {
  const subjectId = getTeamId(teamId);
  observability.captureException({
    error,
    source,
    subjectId,
    severity,
    context: { ...context, team_id: subjectId },
  });
}

export function captureEvent({
  event,
  source,
  teamId,
  properties = {},
}: {
  event: string;
  source: string;
  teamId?: unknown;
  properties?: Record<string, unknown>;
}) {
  const subjectId = getTeamId(teamId);
  productEvents.captureEvent({
    event,
    source,
    subjectId,
    properties: { ...properties, team_id: subjectId },
  });
}
