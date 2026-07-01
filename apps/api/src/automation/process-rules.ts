import logger from "../services/log";
import {
  deleteRule,
  enrollContactsInOngoingSequence,
  getDueDateRules,
  getMatchingContactIds,
  getSequenceRowBySequenceId,
  lockBroadcast,
} from "./queries";
import type { ContactFilterWithAggregator } from "../contacts/segment";

/**
 * Ported from `courselit/apps/queue/src/domain/process-rules.ts`. Only handles
 * `DATE_OCCURRED` rules (used to schedule broadcasts). Tag/subscriber based
 * triggers are handled immediately by `automation/fire-event.ts` instead of
 * being polled here.
 */
export async function processRules() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const dueRules = await getDueDateRules();
      for (const rule of dueRules) {
        try {
          await processRule(rule);
        } catch (err: any) {
          logger.error(
            { error: err.message, sequence_id: rule.sequenceId },
            "processRules.rule failed",
          );
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "processRules.loop failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
  }
}

async function processRule(rule: {
  ruleId: string;
  teamId: string;
  sequenceId: string;
}) {
  // sequenceId on a rule is the public sequence_id; find its row.
  const sequenceRow = await getSequenceRowBySequenceId(
    rule.teamId,
    rule.sequenceId,
  );
  if (!sequenceRow) {
    await deleteRule(rule.ruleId);
    return;
  }

  const contactIds = await getMatchingContactIds(
    rule.teamId,
    sequenceRow.filter as ContactFilterWithAggregator | null,
  );

  logger.info(
    { sequence_id: sequenceRow.sequenceId, recipients: contactIds.length },
    "Enrolling contacts into broadcast",
  );

  await enrollContactsInOngoingSequence({
    teamId: rule.teamId,
    sequenceId: sequenceRow.sequenceId,
    contactIds,
  });

  await lockBroadcast(sequenceRow.id, contactIds);
  await deleteRule(rule.ruleId);
}
