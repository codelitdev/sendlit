import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { notifyOrganizationOwners } from "../billing/notifications";
import { positiveInt } from "../billing/reputation-config";
import { db } from "../db/client";
import { emailDeliveries, outboundMessages, sequences, teams } from "../db/schema";
import { captureEvent } from "../observability";
import { removeRule } from "../sequences/helpers";
import logger from "../services/log";

/** Per-sequence auto-pause thresholds (#25), checked while it sends:
 * Mailchimp-style 2% bounces / 0.08% complaints once 100 emails went out,
 * five failed sends in a row, or a fatal ESP error. */
export function readSendingHealthConfig() {
  return {
    minimumSent: positiveInt("AUTO_PAUSE_MIN_SENT", 100),
    bounceBps: positiveInt("AUTO_PAUSE_BOUNCE_BPS", 200),
    complaintBps: positiveInt("AUTO_PAUSE_COMPLAINT_BPS", 8),
    consecutiveFailures: positiveInt("AUTO_PAUSE_CONSECUTIVE_FAILURES", 5),
    /** How often one sequence's rates are re-checked while it sends. */
    checkIntervalMs: positiveInt("AUTO_PAUSE_CHECK_SECONDS", 30, 3_600) * 1000,
  };
}

export type AutoPauseReason =
  | "bounce_rate"
  | "complaint_rate"
  | "consecutive_failures"
  | "esp_error"
  | "render_error";

export type SequenceDeliveryRates = {
  sent: number;
  bounced: number;
  complained: number;
  bounceRate: number;
  complaintRate: number;
};

/** Accepted, bounced and complained sends of one sequence (internal id),
 * from the outbound ledger, so retries and duplicate events count once. */
export async function sequenceDeliveryRates(
  sequenceId: string,
  /** Only count sends from then on, e.g. since the sequence was resumed. */
  since?: Date,
): Promise<SequenceDeliveryRates> {
  const [row] = await db
    .select({
      sent: count(),
      bounced: count(
        sql`CASE WHEN ${outboundMessages.deliveryStatus} = 'bounced' THEN 1 END`,
      ),
      complained: count(
        sql`CASE WHEN ${outboundMessages.feedbackStatus} = 'complained' THEN 1 END`,
      ),
    })
    .from(outboundMessages)
    .innerJoin(
      emailDeliveries,
      eq(emailDeliveries.id, outboundMessages.campaignDeliveryId),
    )
    .where(
      and(
        eq(emailDeliveries.sequenceId, sequenceId),
        isNotNull(outboundMessages.acceptedAt),
        since ? gte(outboundMessages.acceptedAt, since) : undefined,
      ),
    );
  const sent = Number(row?.sent ?? 0);
  const bounced = Number(row?.bounced ?? 0);
  const complained = Number(row?.complained ?? 0);
  return {
    sent,
    bounced,
    complained,
    bounceRate: sent ? bounced / sent : 0,
    complaintRate: sent ? complained / sent : 0,
  };
}

/** SMTP rejections that mean the ESP account can't send at all, so carrying
 * on would only fail every recipient. Throttling isn't one of them. */
export function isFatalEspError(error: unknown): boolean {
  const err = error as { message?: unknown; responseCode?: unknown };
  const message = typeof err?.message === "string" ? err.message : "";
  if (/throttl|rate exceeded|try again/i.test(message)) return false;
  return (
    err?.responseCode === 535 ||
    /account (is )?(suspended|disabled|paused|blocked)|sending (is )?(paused|disabled)|(email address|identity|domain|sender)[^.]*not verified|mail from[^.]*not (verified|allowed|authori[sz]ed)|authentication (failed|unsuccessful)/i.test(
      message,
    )
  );
}

const PERCENT = (value: number) => `${(value * 100).toFixed(2)}%`;

/**
 * Pauses a running sequence or broadcast (only if it's still active, so it
 * happens once) and tells the organization's owners why. Its remaining
 * deliveries stay queued and continue when it is resumed.
 */
/** Why a `render_error` auto-pause happened, in words for the team. */
export function renderErrorReason(code: string): string {
  if (code === "footer_render_context_required") {
    return "the workspace has no mailing address for the footer";
  }
  if (code.startsWith("footer_") || code === "invalid_footer") {
    return "the footer with your mailing address couldn't be built";
  }
  return `the email's content couldn't be built (${code})`;
}

export async function autoPauseSequence(
  sequence: Pick<
    typeof sequences.$inferSelect,
    "id" | "sequenceId" | "teamId" | "title" | "type"
  >,
  reason: AutoPauseReason,
  details: Record<string, unknown> = {},
): Promise<boolean> {
  const autoPause = { reason, at: Date.now(), ...details };
  const [paused] = await db
    .update(sequences)
    .set({
      status: "paused",
      report: sql`jsonb_set(coalesce(${sequences.report}, '{}'::jsonb), '{autoPause}', ${JSON.stringify(autoPause)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(and(eq(sequences.id, sequence.id), eq(sequences.status, "active")))
    .returning({ id: sequences.id });
  if (!paused) return false;
  await removeRule({ teamId: sequence.teamId, sequenceId: sequence.id });
  logger.warn(
    { sequence_id: sequence.sequenceId, reason },
    "sequence paused automatically",
  );
  captureEvent({
    event: "sequence_auto_paused",
    source: "automation.sending_health",
    teamId: sequence.teamId,
    properties: { sequence_id: sequence.sequenceId, reason },
  });
  const [team] = await db
    .select({ organizationId: teams.organizationId, name: teams.name })
    .from(teams)
    .where(eq(teams.id, sequence.teamId))
    .limit(1);
  if (team) {
    const what = sequence.type === "broadcast" ? "broadcast" : "sequence";
    const why =
      reason === "bounce_rate"
        ? `${PERCENT(Number(details.bounceRate))} of its emails bounced`
        : reason === "complaint_rate"
          ? `${PERCENT(Number(details.complaintRate))} of recipients marked it as spam`
          : reason === "consecutive_failures"
            ? "several emails in a row failed to send"
            : reason === "render_error"
              ? renderErrorReason(String(details.error ?? ""))
              : `your email provider refused to send (${String(details.error ?? "")})`;
    const next =
      reason === "render_error"
        ? "Check your mailing address in Settings and the email's content, then resume it from SendLit"
        : "Sending more would hurt your sender reputation. Check your list and your email provider, then resume it from SendLit";
    await notifyOrganizationOwners(
      team.organizationId,
      `Paused: "${sequence.title}"`,
      `SendLit paused the ${what} "${sequence.title}" in ${team.name} because ${why}. ${next}; emails that haven't gone out yet are still queued.`,
    ).catch(() => undefined);
  }
  return true;
}

const lastChecked = new Map<string, number>();

/**
 * Checks a running sequence's bounce and complaint rates (at most every
 * `AUTO_PAUSE_CHECK_SECONDS` per sequence) and pauses it when they cross the thresholds.
 * Returns true if the sequence is now paused.
 */
export async function pauseIfUnhealthy(
  sequence: Pick<
    typeof sequences.$inferSelect,
    "id" | "sequenceId" | "teamId" | "title" | "type" | "report"
  >,
): Promise<boolean> {
  const config = readSendingHealthConfig();
  const now = Date.now();
  if (now - (lastChecked.get(sequence.id) ?? 0) < config.checkIntervalMs) return false;
  lastChecked.set(sequence.id, now);
  // After a resume only new sends count, so a cleaned-up list gets a fresh
  // start instead of re-pausing on the old bounces.
  const healthSince = (sequence.report as { healthSince?: number } | null)?.healthSince;
  const rates = await sequenceDeliveryRates(
    sequence.id,
    healthSince ? new Date(healthSince) : undefined,
  );
  if (rates.sent < config.minimumSent) return false;
  const details = {
    sent: rates.sent,
    bounceRate: rates.bounceRate,
    complaintRate: rates.complaintRate,
  };
  if (rates.complaintRate * 10_000 >= config.complaintBps) {
    return autoPauseSequence(sequence, "complaint_rate", details);
  }
  if (rates.bounceRate * 10_000 >= config.bounceBps) {
    return autoPauseSequence(sequence, "bounce_rate", details);
  }
  return false;
}

export function resetSendingHealthCacheForTests(): void {
  lastChecked.clear();
}

/** Whether the sequence was paused since this delivery was picked up. */
export async function isSequencePaused(sequenceId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: sequences.status })
    .from(sequences)
    .where(eq(sequences.id, sequenceId))
    .limit(1);
  return row?.status === "paused";
}

/** Counts a failed send of a sequence; returns how many failed in a row. */
export async function recordSendFailure(sequenceId: string): Promise<number> {
  const [row] = await db
    .update(sequences)
    .set({
      report: sql`jsonb_set(coalesce(${sequences.report}, '{}'::jsonb), '{health}', jsonb_build_object('consecutiveFailures', coalesce((${sequences.report}->'health'->>'consecutiveFailures')::int, 0) + 1))`,
    })
    .where(eq(sequences.id, sequenceId))
    .returning({ report: sequences.report });
  return Number((row?.report as any)?.health?.consecutiveFailures ?? 0);
}

/** Clears the failure streak after a successful send. */
export async function recordSendSuccess(sequenceId: string): Promise<void> {
  await db
    .update(sequences)
    .set({ report: sql`${sequences.report} - 'health'` })
    .where(
      and(
        eq(sequences.id, sequenceId),
        sql`${sequences.report}->'health'->>'consecutiveFailures' IS NOT NULL`,
      ),
    );
}
