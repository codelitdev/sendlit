import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { customFieldsSchema } from "@sendlit/api-contract";
import {
    addTagToContact,
    countContacts,
    createContact,
    deleteContact,
    getContactByContactId,
    getDeliveriesByContact,
    listContacts,
    removeTagFromContact,
    updateContact,
} from "../../contacts/queries";
import { getSegment } from "../../contacts/segments-queries";
import { contactFilterSchema } from "@sendlit/api-contract";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import {
    contactListSchema,
    contactSchema,
    contactDeliveryListSchema,
    successMessageSchema,
} from "./schemas";
import { getTeamId } from "./auth";
import { omitInternal } from "../../utils/public";
import { serializeDates } from "../../utils/serialize";

export function registerContactTools(server: McpServer): void {
    server.registerTool(
        "list_contacts",
        {
            description:
                "Returns a paginated list of contacts (subscribers), optionally filtered by a search term matching email or name, and/or by a saved segment's filter.",
            inputSchema: {
                q: z.string().optional().describe("Search by email or name"),
                segmentId: z
                    .string()
                    .optional()
                    .describe(
                        "Only return contacts currently matching this saved segment's filter",
                    ),
                filter: contactFilterSchema
                    .optional()
                    .describe(
                        "Inline contact filter; combines with q and segmentId using AND",
                    ),
                offset: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe("Page number, 1-indexed (default: 1)"),
            },
            outputSchema: contactListSchema,
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
                const filters = [];
                if (args.segmentId) {
                    const segment = await getSegment(args.segmentId);
                    if (!segment || segment.teamId !== teamId) return NOT_FOUND;
                    const parsedSegmentFilter = contactFilterSchema.safeParse(
                        segment.filter,
                    );
                    if (!parsedSegmentFilter.success) return INTERNAL_ERROR;
                    filters.push(parsedSegmentFilter.data as any);
                }
                if (args.filter) {
                    filters.push(args.filter);
                }
                const filter = filters.length ? filters : undefined;
                const [items, total] = await Promise.all([
                    listContacts({
                        teamId,
                        searchText: args.q,
                        filter,
                        offset: args.offset,
                    }),
                    countContacts(teamId, { searchText: args.q, filter }),
                ]);
                return jsonResult({
                    items: items.map((item) => omitInternal(item)),
                    total,
                });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_contact",
        {
            description: "Returns a single contact by its contact ID.",
            inputSchema: {
                contactId: z.string().describe("Contact ID"),
            },
            outputSchema: contactSchema,
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
                const contact = await getContactByContactId(args.contactId);
                if (!contact || contact.teamId !== teamId) return NOT_FOUND;
                return jsonResult(omitInternal(contact));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "get_contact_deliveries",
        {
            description:
                "Returns the broadcasts and sequence emails a contact has received, newest first.",
            inputSchema: {
                contactId: z.string().describe("Contact ID"),
            },
            outputSchema: contactDeliveryListSchema,
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
                const contact = await getContactByContactId(args.contactId);
                if (!contact || contact.teamId !== teamId) return NOT_FOUND;
                const deliveries = await getDeliveriesByContact(
                    teamId,
                    contact.id,
                );
                return jsonResult({ items: serializeDates(deliveries) });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "create_contact",
        {
            description:
                "Creates a contact (subscriber). If a contact with the same email already exists, the existing contact is returned instead. Any attributes beyond email and name (e.g. company, age, plan, role) must be passed as scalar or scalar-array values in customFields.",
            inputSchema: {
                email: z.string().email().describe("Contact's email address"),
                name: z.string().optional().describe("Contact's display name"),
                tags: z.array(z.string()).optional().describe("Initial tags"),
                customFields: customFieldsSchema
                    .optional()
                    .describe(
                        "Arbitrary scalar or scalar-array attributes such as company, age, plan, roles, product ids, etc.",
                    ),
            },
            outputSchema: contactSchema,
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
                const contact = await createContact({ teamId, ...args });
                return jsonResult(omitInternal(contact));
            } catch (err: any) {
                return {
                    content: [{ type: "text" as const, text: err.message }],
                    isError: true,
                };
            }
        },
    );

    server.registerTool(
        "update_contact",
        {
            description:
                "Updates a contact's name, tags, subscription, or custom fields. customFields accepts scalar or scalar-array values and replaces all existing custom fields — include any you want to keep.",
            inputSchema: {
                contactId: z.string().describe("Contact ID"),
                name: z.string().optional(),
                subscribed: z.boolean().optional(),
                tags: z.array(z.string()).optional(),
                customFields: customFieldsSchema
                    .optional()
                    .describe("Custom fields (replaces existing)"),
            },
            outputSchema: contactSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: false,
            },
        },
        async (args: any, extra: any) => {
            const teamId = getTeamId(extra);
            if (!teamId) return AUTH_ERROR;
            const { contactId, ...patch } = args;
            try {
                const contact = await updateContact(teamId, contactId, patch);
                if (!contact) return NOT_FOUND;
                return jsonResult(omitInternal(contact));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "add_contact_tag",
        {
            description:
                "Adds a tag to a contact. May trigger any sequence enrolled on tag-added.",
            inputSchema: { contactId: z.string(), tag: z.string() },
            outputSchema: contactSchema,
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
                const contact = await addTagToContact(
                    teamId,
                    args.contactId,
                    args.tag,
                );
                if (!contact) return NOT_FOUND;
                return jsonResult(omitInternal(contact));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "remove_contact_tag",
        {
            description:
                "Removes a tag from a contact. May trigger any sequence enrolled on tag-removed.",
            inputSchema: { contactId: z.string(), tag: z.string() },
            outputSchema: contactSchema,
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
                const contact = await removeTagFromContact(
                    teamId,
                    args.contactId,
                    args.tag,
                );
                if (!contact) return NOT_FOUND;
                return jsonResult(omitInternal(contact));
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );

    server.registerTool(
        "delete_contact",
        {
            description:
                "Permanently deletes a contact. This action cannot be undone.",
            inputSchema: { contactId: z.string() },
            outputSchema: successMessageSchema,
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
                await deleteContact(teamId, args.contactId);
                return jsonResult({ message: "Contact deleted." });
            } catch {
                return INTERNAL_ERROR;
            }
        },
    );
}
