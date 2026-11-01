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
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, notFound, planGateError, toolError } from "./responses";

/** An `EventsError` as REST splits it: a missing contact is 404, a name that
 * exists or is in use is 409, anything else (the event name limit) is 422. */
function eventsError(err: EventsError) {
  if (err.code === "contact_not_found") {
    return toolError("not_found", { reason: err.code });
  }
  if (
    err.code === "event_definition_exists" ||
    err.code === "event_definition_in_use"
  ) {
    return toolError("conflict", { reason: err.code });
  }
  return toolError("validation_failed", { reason: err.code });
}

/** Custom events — the MCP side of `events/routes.ts`. See
 * docs/custom_events.md. */
export const eventTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "track_event",
    title: "Track Event",
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
        if (err instanceof EventsError) return eventsError(err);
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "list_event_definitions",
    title: "List Events",
    operationId: "events.definitions",
    risk: "read",
    description:
      "Lists the team's events: registered on first receipt or by hand, with their properties, when they were last received, and how many sequences use each.",
    inputSchema: z.object({}),
    outputSchema: z.object({ items: z.array(eventDefinitionSchema) }),
    annotations: { openWorldHint: false },
    async handler({ context }) {
      return { items: await listEventDefinitions(context.teamId) };
    },
  }),

  dedicatedTool({
    name: "get_event_definition",
    title: "Get Event",
    operationId: "events.definition",
    risk: "read",
    description: "Gets one event, including the properties of the last one received.",
    inputSchema: z.object({ name: eventNameSchema }),
    outputSchema: eventDefinitionDetailSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const row = await getEventDefinition(context.teamId, args.name);
      return row ?? notFound();
    },
  }),

  dedicatedTool({
    name: "create_event_definition",
    title: "Create Event",
    operationId: "events.createDefinition",
    risk: "write",
    description:
      "Registers an event before your app sends it, so sequences can use it as a trigger and its properties show up in the builder. Counts toward the team's 500-event limit.",
    inputSchema: createEventDefinitionBodySchema,
    outputSchema: eventDefinitionDetailSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        return await createEventDefinition(context.teamId, args);
      } catch (err) {
        if (err instanceof EventsError) return eventsError(err);
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "update_event_definition",
    title: "Update Event",
    operationId: "events.updateDefinition",
    risk: "write",
    description:
      "Updates an event's description or declared properties. properties replaces the declared set; properties seen in received events stay.",
    inputSchema: updateEventDefinitionBodySchema.extend({ name: eventNameSchema }),
    outputSchema: eventDefinitionDetailSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { name, ...patch } = args;
      const row = await updateEventDefinition(context.teamId, name, patch);
      return row ?? notFound();
    },
  }),

  dedicatedTool({
    name: "delete_event_definition",
    title: "Delete Event",
    operationId: "events.deleteDefinition",
    risk: "destructive",
    description:
      "Removes an event from the team's list. Stored events are kept, and a later event with the name registers it again. Fails with event_definition_in_use while a sequence uses it as its trigger.",
    inputSchema: z.object({ name: eventNameSchema }),
    outputSchema: z.object({ deleted: z.boolean() }),
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const deleted = await deleteEventDefinition(context.teamId, args.name);
        return deleted ? { deleted: true } : notFound();
      } catch (err) {
        if (err instanceof EventsError) return eventsError(err);
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "get_contact_events",
    title: "Get Contact Events",
    operationId: "contacts.events",
    risk: "read",
    description:
      "Lists the custom events received for a contact, newest first, with the sequences each one started.",
    inputSchema: listContactEventsQuerySchema.extend({ contactId: z.string() }),
    outputSchema: z.object({ items: z.array(contactEventSchema), total: z.number() }),
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const contact = await getContactByContactId(args.contactId);
      if (!contact || contact.teamId !== context.teamId) return notFound();
      return await listContactEvents(contact.id, {
        page: args.page,
        limit: args.limit,
        name: args.name,
      });
    },
  }),
];
