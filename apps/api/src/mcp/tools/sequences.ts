import {
  contactFilterSchema,
  emailContentInputSchema,
  sequenceEmailTestResultSchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { broadcastPacing } from "../../abuse/pacing-status";
import { sequenceDeliveryRates } from "../../automation/sending-health";
import { emailActionTypes, mailTypes } from "../../config/constants";
import type { HydratedSequence } from "../../sequences/queries";
import {
  addMailToSequence,
  countSequences,
  createSequence,
  deleteMailFromSequence,
  getEmailSentCount,
  getSequenceBySequenceId,
  getSequenceClickThroughRate,
  getSequenceOpenRate,
  getSubscribers,
  getSubscribersCount,
  listSequences,
  pauseSequence,
  startSequence,
  updateMailInSequence,
  updateSequence,
} from "../../sequences/queries";
import { sendSequenceEmailTest } from "../../sequences/test-send";
import { omitInternal } from "../../utils/public";
import type { McpToolRegistrar } from "../tool-registry";
import { getAuthUser, getTeamId } from "./auth";
import {
  AUTH_ERROR,
  errorResult,
  INTERNAL_ERROR,
  isPlanGateError,
  jsonResult,
  NOT_FOUND,
  planGateResult,
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

export function registerSequenceTools(server: McpToolRegistrar): void {
  server.registerTool(
    "list_sequences",
    {
      description:
        "Returns a paginated list of broadcasts (type=broadcast, one-off) or sequences (type=sequence, multi-step, event-triggered).",
      inputSchema: {
        type: z.enum(mailTypes),
        offset: z.number().int().min(1).optional().describe("Page number (default: 1)"),
        itemsPerPage: z.number().int().min(1).max(50).optional(),
      },
      outputSchema: sequenceListSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const [items, total] = await Promise.all([
          listSequences({
            teamId,
            type: args.type,
            offset: args.offset,
            itemsPerPage: args.itemsPerPage,
          }),
          countSequences(teamId, args.type),
        ]);
        return jsonResult({
          items: items.map(toPublicSequence),
          total,
        });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_sequence",
    {
      description:
        "Returns a broadcast or sequence, including its emails, by its sequence ID.",
      inputSchema: { sequenceId: z.string() },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await getSequenceBySequenceId(teamId, args.sequenceId);
        if (!sequence) return NOT_FOUND;
        return jsonResult({
          ...toPublicSequence(sequence),
          pacing: await broadcastPacing(sequence),
        });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "create_sequence",
    {
      description:
        "Creates a new broadcast or sequence from a marketing template or marketing system starter. Transactional templates return template_not_marketing.",
      inputSchema: {
        type: z.enum(mailTypes),
        templateId: z.string().min(1),
        deliverySource: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("organization") }),
            z.object({
              type: z.literal("team"),
              espId: z.string().min(1).optional(),
            }),
          ])
          .optional(),
      },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await createSequence({
          teamId,
          type: args.type,
          templateId: args.templateId,
          deliverySource: args.deliverySource,
        });
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "update_sequence",
    {
      description:
        "Updates a broadcast/sequence's title, trigger, audience filter, exclusion filter, or selected user ESP. A sent broadcast's title (its email's subject) can't be changed.",
      inputSchema: {
        sequenceId: z.string(),
        title: z.string().optional(),
        triggerType: z
          .string()
          .optional()
          .describe("tag:added | tag:removed | subscriber:added | date:occurred"),
        triggerData: z
          .string()
          .optional()
          .describe("e.g. the tag name for tag triggers"),
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
        deliverySource: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("organization") }),
            z.object({
              type: z.literal("team"),
              espId: z.string().min(1).optional(),
            }),
          ])
          .nullable()
          .optional(),
      },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const { sequenceId, ...patch } = args;
      try {
        const sequence = await updateSequence({
          teamId,
          sequenceId,
          ...patch,
        });
        if (!sequence) return NOT_FOUND;
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "add_sequence_email",
    {
      description:
        "Adds a new email step to a sequence from a marketing template. Transactional templates return template_not_marketing.",
      inputSchema: {
        sequenceId: z.string(),
        templateId: z.string().min(1),
      },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await addMailToSequence({
          teamId,
          sequenceId: args.sequenceId,
          templateId: args.templateId,
        });
        if (!sequence) return NOT_FOUND;
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "update_sequence_email",
    {
      description:
        'Updates one email within a sequence/broadcast: subject, content, delay, publish status, or the tag action fired on send. Edits apply to later sends only; the "view in browser" page of an email already sent keeps showing what was sent. A sent broadcast can\'t be edited.',
      inputSchema: {
        sequenceId: z.string(),
        emailId: z.string(),
        subject: z.string().optional(),
        content: emailContentInputSchema.optional(),
        delayInMillis: z
          .number()
          .optional()
          .describe("Milliseconds after the previous email (sequences only)"),
        actionType: z.enum(emailActionTypes).optional(),
        actionData: z.record(z.any()).optional().describe('e.g. { "tag": "vip" }'),
        published: z
          .boolean()
          .optional()
          .describe("Must be true before the sequence/broadcast can be started"),
      },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const { sequenceId, emailId, ...patch } = args;
      try {
        const sequence = await updateMailInSequence({
          teamId,
          sequenceId,
          emailId,
          ...patch,
        });
        if (!sequence) return NOT_FOUND;
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "send_sequence_email_test",
    {
      description:
        "Sends a test of one broadcast/sequence email, rendered exactly like a real send (merge tags, footer, tracking) with a [Test] subject prefix; its \"view in browser\" link shows the email as tested. Defaults to the current user's own address (OAuth sessions only; API-key sessions must supply `to`). Suppressed addresses are skipped; opens, clicks and the unsubscribe link in a test change nothing. Every recipient counts as one test: by default 100 per team in any 24 hours (50 in any 3 hours) and 20 per email per 24 hours (errors `test_send_limit_reached`, `test_send_email_limit_reached`). Tests through an organization's shared mailbox also use the team's shared-delivery quota.",
      inputSchema: {
        sequenceId: z.string(),
        emailId: z.string(),
        to: z.array(z.string().email()).max(5).optional().describe("Up to 5 addresses"),
      },
      outputSchema: sequenceEmailTestResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        return jsonResult(
          await sendSequenceEmailTest({
            teamId,
            sequenceId: args.sequenceId,
            emailId: args.emailId,
            to: args.to,
            fallbackRecipient: getAuthUser(extra)?.email,
          }),
        );
      } catch (err: any) {
        if (isPlanGateError(err)) return planGateResult(err);
        if (err.message === "sequence_not_found" || err.message === "email_not_found") {
          return NOT_FOUND;
        }
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "delete_sequence_email",
    {
      description:
        "Removes an email from a sequence. Broadcasts cannot have their only email removed.",
      inputSchema: { sequenceId: z.string(), emailId: z.string() },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await deleteMailFromSequence({
          teamId,
          sequenceId: args.sequenceId,
          emailId: args.emailId,
        });
        if (!sequence) return NOT_FOUND;
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "start_sequence",
    {
      description:
        "Starts a broadcast (schedules it for delivery) or activates a sequence (begins enrolling contacts on its trigger). Requires a mailing address and at least one published email.",
      inputSchema: { sequenceId: z.string() },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await startSequence({
          teamId,
          sequenceId: args.sequenceId,
        });
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        if (isPlanGateError(err)) return planGateResult(err);
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "pause_sequence",
    {
      description:
        "Pauses an active sequence, or an active broadcast that hasn't sent yet.",
      inputSchema: { sequenceId: z.string() },
      outputSchema: sequenceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await pauseSequence({
          teamId,
          sequenceId: args.sequenceId,
        });
        return jsonResult(toPublicSequence(sequence));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "get_sequence_stats",
    {
      description:
        "Returns delivery stats for a broadcast/sequence: emails sent, recipient count, open rate and click-through rate.",
      inputSchema: { sequenceId: z.string() },
      outputSchema: sequenceStatsSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await getSequenceBySequenceId(teamId, args.sequenceId);
        if (!sequence) return NOT_FOUND;
        const [sent, openRate, clickThroughRate, subscribersCount, rates] =
          await Promise.all([
            getEmailSentCount(args.sequenceId),
            getSequenceOpenRate(args.sequenceId),
            getSequenceClickThroughRate(args.sequenceId),
            getSubscribersCount(args.sequenceId),
            sequenceDeliveryRates(sequence.id),
          ]);
        return jsonResult({
          sent,
          openRate,
          clickThroughRate,
          subscribersCount,
          bounceRate: rates.bounceRate,
          complaintRate: rates.complaintRate,
        });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_sequence_subscribers",
    {
      description:
        "Returns a paginated list of contact IDs that have received at least one email in this sequence or broadcast.",
      inputSchema: {
        sequenceId: z.string().describe("Sequence or broadcast ID"),
        page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Results per page (default: 50)"),
      },
      outputSchema: z.object({
        items: z.array(z.string()),
        total: z.number(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const sequence = await getSequenceBySequenceId(teamId, args.sequenceId);
        if (!sequence) return NOT_FOUND;
        const [items, total] = await Promise.all([
          getSubscribers({
            sequenceId: args.sequenceId,
            page: args.page,
            limit: args.limit,
          }),
          getSubscribersCount(args.sequenceId),
        ]);
        return jsonResult({ items, total });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );
}
