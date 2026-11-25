import { and, count, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { PlanGateError } from "../billing/errors";
import { notifyOrganizationOwners } from "../billing/notifications";
import { advanceControlState, type ControlStatus } from "../billing/reputation-policy";
import { db } from "../db/client";
import {
  espConfigs,
  organizationAuditEvents,
  outboundMessages,
  sharedEspSendingControls,
  teams,
} from "../db/schema";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";
import {
  readSharedEspGuardConfig,
  type SharedEspGuardConfig,
  sharedEspDecision,
  type TeamEspMetrics,
} from "./shared-esp-policy";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type ControlRow = typeof sharedEspSendingControls.$inferSelect;
type GuardStatus = "normal" | "warned" | "marketing_paused";

type ControlChange = {
  organizationId: string;
  espConfigId: string;
  espPublicId: string;
  espName: string;
  teamId: string | null;
  previous: GuardStatus;
  status: GuardStatus;
  reason: string;
  /** Teams paused on this ESP after the change, for the owners' email. */
  pausedTeams: number;
};

/** Each team's seven-day counts through one organization ESP, from the
 * deduplicated outbound ledger (the same projection team reputation uses). */
export async function sharedEspMetrics(
  espConfigId: string,
  now = new Date(),
  options: { since?: Date; teamId?: string } = {},
): Promise<TeamEspMetrics[]> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const since =
    options.since && options.since > windowStart ? options.since : windowStart;
  const rows = await db
    .select({
      teamId: outboundMessages.teamId,
      accepted: count(),
      bounced: count(
        sql`CASE WHEN ${outboundMessages.deliveryStatus} = 'bounced' THEN 1 END`,
      ),
      complained: count(
        sql`CASE WHEN ${outboundMessages.feedbackStatus} = 'complained' THEN 1 END`,
      ),
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.espConfigId, espConfigId),
        eq(outboundMessages.deliverySourceType, "organization"),
        gte(outboundMessages.acceptedAt, since),
        lt(outboundMessages.acceptedAt, now),
        options.teamId ? eq(outboundMessages.teamId, options.teamId) : undefined,
      ),
    )
    .groupBy(outboundMessages.teamId);
  return rows.map((row) => ({
    teamId: row.teamId,
    accepted: Number(row.accepted),
    bounced: Number(row.bounced),
    complained: Number(row.complained),
  }));
}

/**
 * Re-evaluates one organization ESP (#220, ADR 0013): pauses marketing for
 * the teams pushing its combined bounce or complaint rate up, and for the
 * whole ESP only when the problem is broad. Row-locked and idempotent, so
 * replicas and event-driven calls can overlap safely.
 */
export async function evaluateSharedEsp(
  espConfigId: string,
  now = new Date(),
  config: SharedEspGuardConfig = readSharedEspGuardConfig(),
): Promise<void> {
  if (!config.enabled) return;
  const [esp] = await db
    .select({
      id: espConfigs.id,
      espId: espConfigs.espId,
      name: espConfigs.name,
      ownerScope: espConfigs.ownerScope,
      organizationId: espConfigs.organizationId,
    })
    .from(espConfigs)
    .where(eq(espConfigs.id, espConfigId))
    .limit(1);
  if (esp?.ownerScope !== "organization" || !esp.organizationId) return;
  const organizationId = esp.organizationId;

  const metrics = await graceAwareMetrics(espConfigId, now);
  const decision = sharedEspDecision(metrics, config);
  const byTeam = new Map(metrics.map(({ teamId, ...counts }) => [teamId, counts]));
  const changes: ControlChange[] = [];

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(sharedEspSendingControls)
      .where(eq(sharedEspSendingControls.espConfigId, espConfigId))
      .for("update");

    const apply = async (
      row: ControlRow | undefined,
      teamId: string | null,
      desired: { status: GuardStatus; reason: string },
      counts: { accepted: number; bounced: number; complained: number },
    ) => {
      let control = row;
      if (!control) {
        if (desired.status === "normal") return;
        [control] = await tx
          .insert(sharedEspSendingControls)
          .values({ organizationId, espConfigId, teamId, status: "normal" })
          .onConflictDoNothing()
          .returning();
        if (!control) return; // another evaluator created it; it decides.
      }
      const current = control.status as GuardStatus;
      const transition = advanceControlState(
        {
          status: current as ControlStatus,
          reasonCode: control.reasonCode,
          evaluatedAt: control.evaluatedAt,
          cleanEvaluationDays: control.cleanEvaluationDays,
          minimumHoldUntil: control.minimumHoldUntil,
        },
        desired,
        now,
        {
          minimumHoldHours: config.minimumHoldHours,
          recoveryCleanDays: config.recoveryCleanDays,
          recoveredReason: "shared_esp_recovered",
          heldReason: teamId ? "shared_esp_team_breach" : "shared_esp_breach",
        },
      );
      const next = transition.status as GuardStatus;
      if (next === current && transition.alreadyEvaluatedToday) return;
      await tx
        .update(sharedEspSendingControls)
        .set({
          status: next,
          reasonCode: transition.reason,
          source: next === current ? control.source : "automatic",
          enteredAt: next === current ? control.enteredAt : now,
          evaluatedAt: now,
          minimumHoldUntil: transition.minimumHoldUntil,
          cleanEvaluationDays: transition.cleanEvaluationDays,
          updatedAt: now,
        })
        .where(eq(sharedEspSendingControls.id, control.id));
      if (next === current) return;
      await tx.insert(organizationAuditEvents).values({
        organizationId,
        teamId,
        espConfigId,
        actorType: "system",
        action: `shared_esp_${next}`,
        metadata: { reason: transition.reason, ...counts },
      });
      changes.push({
        organizationId,
        espConfigId,
        espPublicId: esp.espId,
        espName: esp.name,
        teamId,
        previous: current,
        status: next,
        reason: transition.reason,
        pausedTeams: decision.pausedTeams.length,
      });
    };

    await apply(
      existing.find((row) => row.teamId === null),
      null,
      decision.esp,
      decision.total,
    );
    const paused = new Map(decision.pausedTeams.map((team) => [team.teamId, team]));
    const teamIds = new Set([
      ...paused.keys(),
      ...existing.flatMap((row) => (row.teamId ? [row.teamId] : [])),
    ]);
    for (const teamId of teamIds) {
      const pause = paused.get(teamId);
      await apply(
        existing.find((row) => row.teamId === teamId),
        teamId,
        pause
          ? { status: "marketing_paused", reason: pause.reason }
          : { status: "normal", reason: "shared_esp_clean" },
        byTeam.get(teamId) ?? { accepted: 0, bounced: 0, complained: 0 },
      );
    }
  });

  // Owners' emails go out in the background so a bounce receipt isn't held
  // up by mail; the change itself is already committed and audited.
  for (const change of changes) void announce(change);
}

/**
 * Seven-day metrics for the decision. While an operator release is in its
 * grace, the released scope (the whole ESP, or one team) counts only sends
 * accepted after the release: the bounces the operator reviewed can't pause
 * it again, but a new bad list still does.
 */
async function graceAwareMetrics(
  espConfigId: string,
  now: Date,
): Promise<TeamEspMetrics[]> {
  const rows = await db
    .select({
      teamId: sharedEspSendingControls.teamId,
      releasedAt: sharedEspSendingControls.releasedAt,
      releaseGraceUntil: sharedEspSendingControls.releaseGraceUntil,
    })
    .from(sharedEspSendingControls)
    .where(eq(sharedEspSendingControls.espConfigId, espConfigId));
  const releasedAt = (row: (typeof rows)[number]) =>
    row.releasedAt && row.releaseGraceUntil && row.releaseGraceUntil > now
      ? row.releasedAt
      : undefined;
  const espRelease = rows.find((row) => row.teamId === null);
  const metrics = await sharedEspMetrics(espConfigId, now, {
    since: espRelease ? releasedAt(espRelease) : undefined,
  });
  for (const row of rows) {
    const since = releasedAt(row);
    if (!row.teamId || !since) continue;
    const teamId = row.teamId;
    const [fresh] = await sharedEspMetrics(espConfigId, now, { since, teamId });
    const index = metrics.findIndex((team) => team.teamId === teamId);
    if (index >= 0) metrics.splice(index, 1);
    if (fresh) metrics.push(fresh);
  }
  return metrics;
}

/** Records the change in PostHog and emails the organization's owners.
 * Never rejects. */
function announce(change: ControlChange): Promise<void> {
  captureEvent({
    event: "shared_esp_control_changed",
    source: "delivery.shared_esp_guard",
    teamId: change.teamId ?? undefined,
    properties: {
      organization_id: change.organizationId,
      esp_id: change.espPublicId,
      outcome: change.status,
      reason: change.reason,
    },
  });
  return notifySharedEspChange(change).catch((error) =>
    captureError({ error, source: "delivery.shared_esp_guard.notify" }),
  );
}

async function notifySharedEspChange(change: ControlChange): Promise<void> {
  let teamName: string | null = null;
  if (change.teamId) {
    const [team] = await db
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, change.teamId))
      .limit(1);
    teamName = team?.name ?? null;
  }
  const mailbox = `the shared mailbox "${change.espName}"`;
  const [subject, text] =
    change.status === "marketing_paused"
      ? teamName
        ? [
            `Marketing email paused for ${teamName}`,
            `SendLit paused broadcasts and sequences from ${teamName} through ${mailbox}. Its bounce or complaint rate over the last 7 days was high enough to put the mailbox's standing with its email provider at risk, which would affect every team that sends through it. Transactional email still sends. The pause lifts on its own once the team's recent sends are clean; ask SendLit support if it needs an earlier review.`,
          ]
        : [
            `Marketing email paused on ${change.espName}`,
            `SendLit paused broadcasts and sequences for every team on ${mailbox}. Its combined bounce or complaint rate over the last 7 days is high across several teams, close to the level where email providers review or suspend an account. Transactional email still sends. Clean up the lists that are bouncing; the pause lifts on its own once recent sends are clean.`,
          ]
      : change.status === "warned"
        ? [
            `Bounce or complaint rate rising on ${change.espName}`,
            `The combined bounce or complaint rate on ${mailbox} over the last 7 days is above SendLit's warning level. ${
              change.pausedTeams > 0
                ? `SendLit has paused marketing email for ${change.pausedTeams === 1 ? "the team" : `the ${change.pausedTeams} teams`} with the highest rates; every other team is still sending.`
                : "Nothing is paused yet."
            } Check which teams' lists are bouncing before it reaches the level where SendLit pauses marketing email for every team.`,
          ]
        : change.previous === "warned"
          ? [
              `Bounce and complaint rates back to normal on ${change.espName}`,
              `The combined bounce and complaint rates on ${mailbox} are back under SendLit's warning level.`,
            ]
          : [
              teamName
                ? `Marketing email resumed for ${teamName}`
                : `Marketing email resumed on ${change.espName}`,
              `Broadcasts and sequences through ${mailbox}${teamName ? ` for ${teamName}` : ""} can send again.`,
            ];
  await notifyOrganizationOwners(change.organizationId, subject, text);
}

/** Event-driven runs evaluate an ESP at most once a minute. Events inside
 * that minute aren't dropped: one trailing run picks them up when it ends.
 * The hourly sweep is the durable backup. */
const lastRun = new Map<string, number>();
const trailing = new Map<string, NodeJS.Timeout>();
const EVENT_THROTTLE_MS = 60_000;

async function runEventEvaluation(espConfigId: string, now = new Date()) {
  lastRun.set(espConfigId, now.getTime());
  try {
    await evaluateSharedEsp(espConfigId, now);
  } catch (error) {
    lastRun.delete(espConfigId);
    logger.warn({ shared_esp_guard_esp: espConfigId }, "shared ESP evaluation failed");
    captureError({ error, source: "delivery.shared_esp_guard.event" });
  }
}

/** Called after a bounce or complaint on a send through an organization ESP.
 * Never throws; failures go to PostHog. */
export async function evaluateSharedEspSoon(
  outbound: { espConfigId: string | null; deliverySourceType: string },
  now = new Date(),
): Promise<void> {
  if (outbound.deliverySourceType !== "organization" || !outbound.espConfigId) return;
  const id = outbound.espConfigId;
  try {
    if (!readSharedEspGuardConfig().enabled) return;
  } catch (error) {
    captureError({ error, source: "delivery.shared_esp_guard.event" });
    return;
  }
  const wait = (lastRun.get(id) ?? 0) + EVENT_THROTTLE_MS - now.getTime();
  if (wait > 0) {
    if (!trailing.has(id)) {
      const timeout = setTimeout(() => {
        trailing.delete(id);
        void runEventEvaluation(id);
      }, wait);
      timeout.unref();
      trailing.set(id, timeout);
    }
    return;
  }
  await runEventEvaluation(id, now);
}

/** Hourly sweep over every organization ESP that sent in the window, plus
 * any with a control row so recoveries advance even after sending stops. */
export async function evaluateAllSharedEsps(now = new Date()): Promise<void> {
  const config = readSharedEspGuardConfig();
  if (!config.enabled) return;
  const since = new Date(now.getTime() - WINDOW_MS);
  const [sending, controlled] = await Promise.all([
    db
      .selectDistinct({ id: outboundMessages.espConfigId })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.deliverySourceType, "organization"),
          gte(outboundMessages.acceptedAt, since),
        ),
      ),
    db
      .selectDistinct({ id: sharedEspSendingControls.espConfigId })
      .from(sharedEspSendingControls),
  ]);
  const ids = new Set(
    [...sending, ...controlled].flatMap((row) => (row.id ? [row.id] : [])),
  );
  for (const id of ids) {
    await evaluateSharedEsp(id, now, config).catch((error) => {
      logger.warn({ shared_esp_guard_esp: id }, "shared ESP evaluation failed");
      captureError({ error, source: "delivery.shared_esp_guard" });
    });
  }
}

/** Refuses a marketing send through an organization ESP that the guard has
 * paused, for this team or for every team. Transactional mail is never
 * stopped here; team reputation controls still govern it. */
export async function assertSharedEspAllowsMarketing(
  teamId: string,
  espConfigId: string,
): Promise<void> {
  if (!readSharedEspGuardConfig().enabled) return;
  const [paused] = await db
    .select({
      teamId: sharedEspSendingControls.teamId,
      reason: sharedEspSendingControls.reasonCode,
    })
    .from(sharedEspSendingControls)
    .where(
      and(
        eq(sharedEspSendingControls.espConfigId, espConfigId),
        eq(sharedEspSendingControls.status, "marketing_paused"),
        or(
          isNull(sharedEspSendingControls.teamId),
          eq(sharedEspSendingControls.teamId, teamId),
        ),
      ),
    )
    .limit(1);
  if (paused) {
    throw new PlanGateError("sending_paused", {
      reason:
        paused.reason ??
        (paused.teamId ? "shared_esp_team_breach" : "shared_esp_breach"),
      scope: paused.teamId ? "team" : "shared_mailbox",
    });
  }
}

/** Audited operator release. The guard won't pause the row again for
 * `graceHours`, so the team can send while its old bounces age out. */
export async function releaseSharedEspControl(input: {
  espConfigId: string;
  teamId: string | null;
  operatorUserId: string;
  operatorReason: string;
  graceHours?: number;
  now?: Date;
}): Promise<boolean> {
  const reason = input.operatorReason.trim();
  if (!reason || reason.length > 500) throw new Error("operator_reason_invalid");
  const now = input.now ?? new Date();
  const graceHours = input.graceHours ?? 7 * 24;
  const [esp] = await db
    .select({ espId: espConfigs.espId, name: espConfigs.name })
    .from(espConfigs)
    .where(eq(espConfigs.id, input.espConfigId))
    .limit(1);
  const change = await db.transaction(async (tx) => {
    const [control] = await tx
      .select()
      .from(sharedEspSendingControls)
      .where(
        and(
          eq(sharedEspSendingControls.espConfigId, input.espConfigId),
          input.teamId
            ? eq(sharedEspSendingControls.teamId, input.teamId)
            : isNull(sharedEspSendingControls.teamId),
        ),
      )
      .limit(1)
      .for("update");
    if (!esp || !control || control.status === "normal") return null;
    await tx
      .update(sharedEspSendingControls)
      .set({
        status: "normal",
        reasonCode: "shared_esp_operator_release",
        source: "operator",
        operatorUserId: input.operatorUserId,
        operatorReason: reason,
        enteredAt: now,
        evaluatedAt: now,
        minimumHoldUntil: null,
        cleanEvaluationDays: 0,
        releasedAt: now,
        releaseGraceUntil: new Date(now.getTime() + graceHours * 60 * 60 * 1000),
        updatedAt: now,
      })
      .where(eq(sharedEspSendingControls.id, control.id));
    await tx.insert(organizationAuditEvents).values({
      organizationId: control.organizationId,
      teamId: control.teamId,
      espConfigId: control.espConfigId,
      actorType: "user",
      actorId: input.operatorUserId,
      action: "shared_esp_operator_release",
      metadata: { reason, graceHours },
    });
    const [paused] = await tx
      .select({ count: count() })
      .from(sharedEspSendingControls)
      .where(
        and(
          eq(sharedEspSendingControls.espConfigId, control.espConfigId),
          eq(sharedEspSendingControls.status, "marketing_paused"),
        ),
      );
    return {
      organizationId: control.organizationId,
      espConfigId: control.espConfigId,
      espPublicId: esp.espId,
      espName: esp.name,
      teamId: control.teamId,
      previous: control.status as GuardStatus,
      status: "normal" as const,
      reason: "shared_esp_operator_release",
      pausedTeams: Number(paused?.count ?? 0),
    };
  });
  if (!change) return false;
  // Awaited: the operator CLI closes the database pool as soon as this returns.
  await announce(change);
  return true;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;

function runSweep() {
  if (running) return;
  running = evaluateAllSharedEsps()
    .catch((error) => {
      logger.error({ error: (error as Error).message }, "shared ESP sweep failed");
      captureError({ error, source: "delivery.shared_esp_guard.sweep" });
    })
    .finally(() => {
      running = null;
    });
}

/** Hourly in every deployment mode; a no-op unless the guard is on. */
export function startSharedEspGuard(intervalMs = 60 * 60 * 1000) {
  if (timer) return;
  runSweep();
  timer = setInterval(runSweep, intervalMs);
  timer.unref();
}

export async function stopSharedEspGuard(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  for (const timeout of trailing.values()) clearTimeout(timeout);
  trailing.clear();
  await running;
}
