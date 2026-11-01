import {
  archivedFilters,
  contactFilterSchema,
  emailContentInputSchema,
  sequenceEmailTestResultSchema,
  updateSequenceBodySchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { broadcastPacing } from "../../abuse/pacing-status";
import { sequenceDeliveryRates } from "../../automation/sending-health";
import { emailActionTypes, mailTypes } from "../../config/constants";
import { responses } from "../../config/strings";
import type { HydratedSequence } from "../../sequences/queries";
import {
  addMailToSequence,
  countSequences,
  createSequence,
  getEmailSentCount,
  getSequenceBySequenceId,
  getSequenceClickThroughRate,
  getSequenceOpenRate,
  getSubscribersCount,
  listSequences,
  pauseSequence,
  startSequence,
  updateMailInSequence,
  updateSequence,
} from "../../sequences/queries";
import { sendSequenceEmailTest } from "../../sequences/test-send";
import { MAILING_ADDRESS_REQUIRED } from "../../settings/general/constants";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import {
  isPlanGateError,
  notFound,
  planGateError,
  type ToolError,
  toolError,
} from "./responses";
import { sequenceListSchema, sequenceSchema, sequenceStatsSchema } from "./schemas";

// `sequenceEmails.sequenceId` stores its *parent* sequence's internal `id`
// (see the file-level doc comment in `db/schema.ts`) — dropped here rather
// than exposed, since it's an internal join key, not a public ID.
function toPublicSequence(sequence: HydratedSequence) {
  return {
    ...omitInternal(sequence, [
      "outboxId",
      "espGrantId",
      "deliverySourceType",
      "deliverySourceIntent",
    ]),
    emails: sequence.emails.map((email) =>
      omitInternal(email, ["sequenceId", "contentScanHash", "contentScanReasons"]),
    ),
  };
}

const NOT_FOUND_REASONS = new Set([
  "sequence_not_found",
  "email_not_found",
  "template_not_found",
  "team_not_found",
  "item_not_found",
]);
const RATE_LIMITED_REASONS = new Set([
  "test_send_limit_reached",
  "test_send_email_limit_reached",
  "organization_team_quota_exhausted",
  "organization_quota_exhausted",
]);
const CONFLICT_REASONS = new Set([
  "sequence_already_started",
  "sequence_not_active",
  "mail_already_sent",
  "broadcast_archived",
  "broadcast_held_for_review",
  "esp_cannot_change_after_start",
  "esp_not_configured",
  "duplicate_title",
]);
const CODE = /^([a-z][a-z0-9_]*)(?::\s*(.+))?$/;
/** The `responses` sentence a sequence query threw (alone, or as
 * `sentence: detail`), keyed back to its code. */
function responseReason(raw: string): string | undefined {
  return Object.entries(responses).find(
    ([, sentence]) => raw === sentence || raw.startsWith(`${sentence}: `),
  )?.[0];
}

/**
 * A sequence query's failure as a tool error. The queries throw either a
 * snake_case code (optionally `code: detail`) or one of the `responses`
 * sentences; both keep their code as `reason`. Anything else is unexpected
 * and is rethrown, so the kit reports it as `internal_error`.
 */
function sequenceError(err: unknown): ToolError {
  if (isPlanGateError(err)) return planGateError(err);
  const raw = err instanceof Error ? err.message : "";
  let reason = responseReason(raw);
  let message: string | undefined = reason ? raw : undefined;
  if (!reason) {
    const match = CODE.exec(raw);
    if (!match) throw err;
    reason = match[1];
    message = match[2];
  }
  const details: Record<string, string> = message ? { reason, message } : { reason };
  if (reason === "action_not_allowed") return toolError("forbidden", details);
  if (NOT_FOUND_REASONS.has(reason)) return toolError("not_found", details);
  if (RATE_LIMITED_REASONS.has(reason)) return toolError("rate_limited", details);
  if (CONFLICT_REASONS.has(reason)) return toolError("conflict", details);
  if (reason === MAILING_ADDRESS_REQUIRED) {
    return toolError("validation_failed", {
      reason,
      message: "A mailing address is required for broadcasts and sequences.",
    });
  }
  return toolError("validation_failed", details);
}

const deliverySourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("organization") }),
  z.object({
    type: z.literal("team"),
    espId: z.string().min(1).optional(),
  }),
]);

export const sequenceTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_sequences",
    operationId: "sequences.list",
    risk: "read",
    description:
      "Returns a paginated list of broadcasts (type=broadcast, one-off) or sequences (type=sequence, multi-step, event-triggered). Archived broadcasts are left out unless archived is only or include.",
    inputSchema: z.object({
      type: z.enum(mailTypes),
      archived: z
        .enum(archivedFilters)
        .optional()
        .describe("exclude (default), only or include archived broadcasts"),
      offset: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      itemsPerPage: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: sequenceListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const [items, total] = await Promise.all([
        listSequences({
          teamId: context.teamId,
          type: args.type,
          offset: args.offset,
          itemsPerPage: args.itemsPerPage,
          archived: args.archived,
        }),
        countSequences(context.teamId, args.type, args.archived),
      ]);
      return { items: items.map(toPublicSequence), total };
    },
  }),

  dedicatedTool({
    name: "get_sequence",
    operationId: "sequences.get",
    risk: "read",
    description:
      "Returns a broadcast or sequence, including its emails, by its sequence ID.",
    inputSchema: z.object({ sequenceId: z.string() }),
    outputSchema: sequenceSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const sequence = await getSequenceBySequenceId(context.teamId, args.sequenceId);
      if (!sequence) return notFound();
      return { ...toPublicSequence(sequence), pacing: await broadcastPacing(sequence) };
    },
  }),

  dedicatedTool({
    name: "create_sequence",
    operationId: "sequences.create",
    risk: "write",
    description:
      "Creates a new broadcast or sequence from a marketing template or marketing system starter. Transactional templates return template_not_marketing.",
    inputSchema: z.object({
      type: z.enum(mailTypes),
      templateId: z.string().min(1),
      deliverySource: deliverySourceSchema.optional(),
    }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const sequence = await createSequence({
          teamId: context.teamId,
          type: args.type,
          templateId: args.templateId,
          deliverySource: args.deliverySource,
        });
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "update_sequence",
    operationId: "sequences.update",
    risk: "write",
    description:
      "Updates a broadcast/sequence's title, trigger (including event:custom with the event name in triggerData and an optional property filter), re-entry setting, audience filter, exclusion filter, selected user ESP, or whether its emails link a hosted web version (\"View in browser\"). A sent broadcast's title (its email's subject) can't be changed.",
    inputSchema: z.object({
      sequenceId: z.string(),
      title: z.string().optional(),
      triggerType: updateSequenceBodySchema.shape.triggerType,
      triggerData: updateSequenceBodySchema.shape.triggerData,
      triggerFilter: updateSequenceBodySchema.shape.triggerFilter,
      reentry: updateSequenceBodySchema.shape.reentry,
      reentryPeriodDays: updateSequenceBodySchema.shape.reentryPeriodDays,
      filter: z
        .object({
          aggregator: z.enum(["and", "or"]),
          filters: z.array(z.record(z.any())),
        })
        .optional()
        .describe(
          "Audience filter (tag/email/subscription/signedUp/customField); empty means every subscribed contact",
        ),
      excludeFilter: contactFilterSchema
        .nullable()
        .optional()
        .describe(
          "Contacts matching this filter never receive the email, even if they match `filter` (e.g. leave out customers). null clears it.",
        ),
      emailsOrder: z.array(z.string()).optional(),
      deliverySource: deliverySourceSchema.nullable().optional(),
      viewInBrowser: z
        .boolean()
        .optional()
        .describe(
          'false leaves the "View in browser" link out of later sends and takes down the web versions behind links already sent (e.g. for onboarding or trial emails). Can be changed at any time.',
        ),
    }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { sequenceId, ...patch } = args;
      try {
        const sequence = await updateSequence({
          teamId: context.teamId,
          sequenceId,
          ...patch,
        } as Parameters<typeof updateSequence>[0]);
        if (!sequence) return notFound();
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "add_sequence_email",
    operationId: "sequences.addEmail",
    risk: "write",
    description:
      "Adds a new email step to a sequence from a marketing template. Transactional templates return template_not_marketing.",
    inputSchema: z.object({
      sequenceId: z.string(),
      templateId: z.string().min(1),
    }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const sequence = await addMailToSequence({
          teamId: context.teamId,
          sequenceId: args.sequenceId,
          templateId: args.templateId,
        });
        if (!sequence) return notFound();
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "update_sequence_email",
    operationId: "sequences.updateEmail",
    risk: "write",
    description:
      'Updates one email within a sequence/broadcast: subject, content, delay, publish status, or the tag action fired on send. Edits apply to later sends only; the "view in browser" page of an email already sent keeps showing what was sent. A sent broadcast can\'t be edited.',
    inputSchema: z.object({
      sequenceId: z.string(),
      emailId: z.string(),
      subject: z.string().optional(),
      content: emailContentInputSchema.optional(),
      delayInMillis: z
        .number()
        .optional()
        .describe(
          "Sequences: milliseconds after the previous email, or after the contact enters for the first email. Broadcasts: the send time (epoch millis)",
        ),
      actionType: z.enum(emailActionTypes).optional(),
      actionData: z.record(z.any()).optional().describe('e.g. { "tag": "vip" }'),
      published: z
        .boolean()
        .optional()
        .describe("Must be true before the sequence/broadcast can be started"),
    }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { sequenceId, emailId, ...patch } = args;
      try {
        const sequence = await updateMailInSequence({
          teamId: context.teamId,
          sequenceId,
          emailId,
          ...patch,
        } as Parameters<typeof updateMailInSequence>[0]);
        if (!sequence) return notFound();
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "send_sequence_email_test",
    operationId: "sequences.sendEmailTest",
    risk: "write",
    description:
      "Sends a test of one broadcast/sequence email, rendered exactly like a real send (merge tags, footer, tracking) with a [Test] subject prefix; its \"view in browser\" link shows the email as tested. Defaults to the current user's own address (OAuth sessions only; API-key sessions must supply `to`). Suppressed addresses are skipped; opens, clicks and the unsubscribe link in a test change nothing. Every recipient counts as one test: by default 100 per team in any 24 hours (50 in any 3 hours) and 20 per email per 24 hours (errors `test_send_limit_reached`, `test_send_email_limit_reached`). Tests through an organization's shared mailbox also use the team's shared-delivery quota.",
    inputSchema: z.object({
      sequenceId: z.string(),
      emailId: z.string(),
      to: z.array(z.string().email()).max(5).optional().describe("Up to 5 addresses"),
    }),
    outputSchema: sequenceEmailTestResultSchema,
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      try {
        return await sendSequenceEmailTest({
          teamId: context.teamId,
          sequenceId: args.sequenceId,
          emailId: args.emailId,
          to: args.to,
          // OAuth sessions default to the signed-in person; a team API key
          // has no single owner, so it must pass `to`.
          fallbackRecipient:
            context.authKind === "oauth" ? context.user?.email : undefined,
        });
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "start_sequence",
    operationId: "sequences.start",
    risk: "write",
    description:
      "Starts a broadcast (schedules it for delivery) or activates a sequence (begins enrolling contacts on its trigger). Requires a mailing address and at least one published email. On SendLit Cloud, a new organization's first broadcast to 1,000 or more contacts through its own ESP is reviewed once first (error `broadcast_held_for_review`); start it again once approved.",
    inputSchema: z.object({ sequenceId: z.string() }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const sequence = await startSequence({
          teamId: context.teamId,
          sequenceId: args.sequenceId,
        });
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "pause_sequence",
    operationId: "sequences.pause",
    risk: "write",
    description:
      "Pauses an active sequence, or an active broadcast that hasn't sent yet.",
    inputSchema: z.object({ sequenceId: z.string() }),
    outputSchema: sequenceSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const sequence = await pauseSequence({
          teamId: context.teamId,
          sequenceId: args.sequenceId,
        });
        return toPublicSequence(sequence);
      } catch (err) {
        return sequenceError(err);
      }
    },
  }),

  dedicatedTool({
    name: "get_sequence_stats",
    operationId: "sequences.stats",
    risk: "read",
    description:
      "Returns delivery stats for a broadcast/sequence: emails sent, recipient count, open rate and click-through rate.",
    inputSchema: z.object({ sequenceId: z.string() }),
    outputSchema: sequenceStatsSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const sequence = await getSequenceBySequenceId(context.teamId, args.sequenceId);
      if (!sequence) return notFound();
      const [sent, openRate, clickThroughRate, subscribersCount, rates] =
        await Promise.all([
          getEmailSentCount(args.sequenceId),
          getSequenceOpenRate(args.sequenceId),
          getSequenceClickThroughRate(args.sequenceId),
          getSubscribersCount(args.sequenceId),
          sequenceDeliveryRates(sequence.id),
        ]);
      return {
        sent,
        openRate,
        clickThroughRate,
        subscribersCount,
        bounceRate: rates.bounceRate,
        complaintRate: rates.complaintRate,
      };
    },
  }),
];
