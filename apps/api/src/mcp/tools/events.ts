import {
  trackEventBodySchema,
  trackEventFieldsSchema,
  trackEventResponseSchema,
} from "@sendlit/api-contract";
import { EventsError, trackEvent } from "../../events/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, planGateError, toolError } from "./responses";

/** Custom events — the MCP side of `events/routes.ts`. See
 * docs/custom_events.md. Event definitions and a contact's event history
 * are reachable through the generic `api.*` tools. */
export const eventTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "track_event",
    operationId: "events.track",
    risk: "write",
    description:
      "Records a custom event (e.g. `course purchased`) for one contact, by email or contactId, and starts every active sequence whose trigger is event:custom with this name and whose filters match. Event properties render as {{ event.<key> }} in that sequence's emails. An unknown email creates the contact unless createContact is false. The same idempotencyKey within 30 days returns the original event. backfill: true (or an occurredAt more than 72 hours old) stores the event without starting anything.",
    inputSchema: trackEventFieldsSchema,
    outputSchema: trackEventResponseSchema,
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      // The cross-field rules (exactly one of email or contactId, ...) live
      // on the REST body schema, which is not a plain object schema.
      const parsed = trackEventBodySchema.safeParse(args);
      if (!parsed.success) {
        return toolError("validation_failed", {
          reason: "invalid_event",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }
      try {
        return await trackEvent({
          teamId: context.teamId,
          source: "mcp",
          body: parsed.data,
        });
      } catch (err) {
        if (isPlanGateError(err)) return planGateError(err);
        if (err instanceof EventsError) {
          return toolError(
            err.code === "contact_not_found" ? "not_found" : "validation_failed",
            { reason: err.code },
          );
        }
        throw err;
      }
    },
  }),
];
