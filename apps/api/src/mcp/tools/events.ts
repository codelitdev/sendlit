import {
  contactEventSchema,
  createEventDefinitionBodySchema,
  eventDefinitionDetailSchema,
  eventDefinitionSchema,
  eventNameSchema,
  listContactEventsQuerySchema,
  trackEventBodySchema,
  trackEventFieldsSchema,
  trackEventResponseSchema,
  updateEventDefinitionBodySchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { getContactByContactId } from "../../contacts/queries";
import {
  createEventDefinition,
  deleteEventDefinition,
  EventsError,
  getEventDefinition,
  listContactEvents,
  listEventDefinitions,
  trackEvent,
  updateEventDefinition,
} from "../../events/queries";
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import {
  AUTH_ERROR,
  errorResult,
  isPlanGateError,
  jsonResult,
  NOT_FOUND,
  planGateResult,
} from "./responses";

/** Custom events — the MCP side of `events/routes.ts`. See
 * docs/custom_events.md. */
export function registerEventTools(server: McpToolRegistrar): void {
  server.registerTool(
    "track_event",
    {
      description:
        "Records a custom event (e.g. `course purchased`) for one contact, by email or contactId, and starts every active sequence whose trigger is event:custom with this name and whose filters match. Event properties render as {{ event.<key> }} in that sequence's emails. An unknown email creates the contact unless createContact is false. The same idempotencyKey within 30 days returns the original event. backfill: true (or an occurredAt more than 72 hours old) stores the event without starting anything.",
      inputSchema: trackEventFieldsSchema.shape,
      outputSchema: trackEventResponseSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const parsed = trackEventBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          parsed.error.issues.map((issue) => issue.message).join("; "),
        );
      }
      try {
        return jsonResult(
          await trackEvent({ teamId, source: "mcp", body: parsed.data }),
        );
      } catch (err: any) {
        if (isPlanGateError(err)) return planGateResult(err);
        if (err instanceof EventsError) return errorResult(err.code);
        throw err;
      }
    },
  );

  server.registerTool(
    "list_event_definitions",
    {
      description:
        "Lists the team's events: registered on first receipt or by hand, with their properties, when they were last received, and how many sequences use each.",
      inputSchema: {},
      outputSchema: z.object({ items: z.array(eventDefinitionSchema) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (_args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult({ items: await listEventDefinitions(teamId) });
    },
  );

  server.registerTool(
    "get_event_definition",
    {
      description: "Gets one event, including the properties of the last one received.",
      inputSchema: { name: eventNameSchema },
      outputSchema: eventDefinitionDetailSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const row = await getEventDefinition(teamId, args.name);
      return row ? jsonResult(row) : NOT_FOUND;
    },
  );

  server.registerTool(
    "create_event_definition",
    {
      description:
        "Registers an event before your app sends it, so sequences can use it as a trigger and its properties show up in the builder. Counts toward the team's 500-event limit.",
      inputSchema: createEventDefinitionBodySchema.shape,
      outputSchema: eventDefinitionDetailSchema,
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
        return jsonResult(await createEventDefinition(teamId, args));
      } catch (err) {
        if (err instanceof EventsError) return errorResult(err.code);
        throw err;
      }
    },
  );

  server.registerTool(
    "update_event_definition",
    {
      description:
        "Updates an event's description or declared properties. properties replaces the declared set; properties seen in received events stay.",
      inputSchema: { name: eventNameSchema, ...updateEventDefinitionBodySchema.shape },
      outputSchema: eventDefinitionDetailSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const { name, ...patch } = args;
      const row = await updateEventDefinition(teamId, name, patch);
      return row ? jsonResult(row) : NOT_FOUND;
    },
  );

  server.registerTool(
    "delete_event_definition",
    {
      description:
        "Removes an event from the team's list. Stored events are kept, and a later event with the name registers it again. Fails with event_definition_in_use while a sequence uses it as its trigger.",
      inputSchema: { name: eventNameSchema },
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const deleted = await deleteEventDefinition(teamId, args.name);
        return deleted ? jsonResult({ deleted: true }) : NOT_FOUND;
      } catch (err) {
        if (err instanceof EventsError) return errorResult(err.code);
        throw err;
      }
    },
  );

  server.registerTool(
    "get_contact_events",
    {
      description:
        "Lists the custom events received for a contact, newest first, with the sequences each one started.",
      inputSchema: { contactId: z.string(), ...listContactEventsQuerySchema.shape },
      outputSchema: z.object({ items: z.array(contactEventSchema), total: z.number() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const contact = await getContactByContactId(args.contactId);
      if (!contact || contact.teamId !== teamId) return NOT_FOUND;
      return jsonResult(
        await listContactEvents(contact.id, {
          page: args.page,
          limit: args.limit,
          name: args.name,
        }),
      );
    },
  );
}
