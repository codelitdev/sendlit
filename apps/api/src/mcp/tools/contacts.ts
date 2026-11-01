import {
  contactFilterSchema,
  customFieldsSchema,
  importContactsBodySchema,
  importContactsResultSchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { importContacts } from "../../contacts/import";
import {
  addTagToContact,
  countContacts,
  createContact,
  getContactByContactId,
  listContacts,
  removeTagFromContact,
  updateContact,
} from "../../contacts/queries";
import { getSegment } from "../../contacts/segments-queries";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, notFound, planGateError, toolError } from "./responses";
import { contactListSchema, contactSchema } from "./schemas";

export const contactTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "import_contacts",
    operationId: "contacts.import",
    risk: "write",
    description:
      "Imports up to 1000 contacts per call from another platform's export (beehiiv, Mailchimp, Substack, Kit, ...), matched by email. Pass each row's source status as-is (e.g. Active, Paused, Inactive, Pending, unsubscribed, cleaned): a status only gets stricter, so an import never re-subscribes anyone, bounced/complained rows are imported unsubscribed and suppressed, and paused contacts get the `paused` tag. Tags and custom fields merge into existing contacts and an earlier createdAt is kept. Imports don't trigger sequences. Returns created/updated/unchanged counts and the skipped rows with reasons.",
    inputSchema: importContactsBodySchema,
    outputSchema: importContactsResultSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        return await importContacts({
          teamId: context.teamId,
          userId: context.user?.id,
          ...args,
        });
      } catch (error) {
        if (isPlanGateError(error)) return planGateError(error);
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "list_contacts",
    operationId: "contacts.list",
    risk: "read",
    description:
      "Returns a paginated list of contacts (subscribers), optionally filtered by a search term matching email or name, and/or by a saved segment's filter.",
    inputSchema: z.object({
      q: z.string().optional().describe("Search by email or name"),
      segmentId: z
        .string()
        .optional()
        .describe(
          "Only return contacts currently matching this saved segment's filter",
        ),
      filter: contactFilterSchema
        .optional()
        .describe("Inline contact filter; combines with q and segmentId using AND"),
      excludeFilter: contactFilterSchema
        .optional()
        .describe("Contacts matching this filter are left out"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number, 1-indexed (default: 1)"),
    }),
    outputSchema: contactListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const teamId = context.teamId;
      try {
        const filters = [];
        if (args.segmentId) {
          const segment = await getSegment(args.segmentId);
          if (!segment || segment.teamId !== teamId) return notFound();
          const parsedSegmentFilter = contactFilterSchema.safeParse(segment.filter);
          if (!parsedSegmentFilter.success) {
            throw new Error("Saved segment filter is invalid");
          }
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
            excludeFilter: args.excludeFilter as any,
            offset: args.offset,
          }),
          countContacts(teamId, {
            searchText: args.q,
            filter,
            excludeFilter: args.excludeFilter as any,
          }),
        ]);
        return {
          items: items.map((item) => omitInternal(item)),
          total,
        };
      } catch (error) {
        if (isPlanGateError(error)) return planGateError(error);
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "get_contact",
    operationId: "contacts.get",
    risk: "read",
    description: "Returns a single contact by its contact ID.",
    inputSchema: z.object({
      contactId: z.string().describe("Contact ID"),
    }),
    outputSchema: contactSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const contact = await getContactByContactId(args.contactId);
      if (!contact || contact.teamId !== context.teamId) return notFound();
      return omitInternal(contact);
    },
  }),

  dedicatedTool({
    name: "create_contact",
    operationId: "contacts.create",
    risk: "write",
    description:
      "Creates a contact (subscriber). If a contact with the same email already exists, the existing contact is returned instead. Any attributes beyond email and name (e.g. company, age, plan, role) must be passed as scalar or scalar-array values in customFields.",
    inputSchema: z.object({
      email: z.string().email().describe("Contact's email address"),
      name: z.string().optional().describe("Contact's display name"),
      tags: z.array(z.string()).optional().describe("Initial tags"),
      customFields: customFieldsSchema
        .optional()
        .describe(
          "Arbitrary scalar or scalar-array attributes such as company, age, plan, roles, product ids, etc.",
        ),
    }),
    outputSchema: contactSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        const contact = await createContact({ teamId: context.teamId, ...args });
        return omitInternal(contact);
      } catch (err: any) {
        if (isPlanGateError(err)) return planGateError(err);
        if (err?.message === "team_not_found") {
          return toolError("not_found", { reason: "team_not_found" });
        }
        throw err;
      }
    },
  }),

  dedicatedTool({
    name: "update_contact",
    operationId: "contacts.update",
    risk: "write",
    description:
      "Updates a contact's name, tags, subscription, or custom fields. customFields accepts scalar or scalar-array values and replaces all existing custom fields — include any you want to keep.",
    inputSchema: z.object({
      contactId: z.string().describe("Contact ID"),
      name: z.string().optional(),
      subscribed: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      customFields: customFieldsSchema
        .optional()
        .describe("Custom fields (replaces existing)"),
    }),
    outputSchema: contactSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { contactId, ...patch } = args;
      try {
        const contact = await updateContact(context.teamId, contactId, patch);
        if (!contact) return notFound();
        return omitInternal(contact);
      } catch (error) {
        if (isPlanGateError(error)) return planGateError(error);
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "add_contact_tag",
    operationId: "contacts.addTag",
    risk: "write",
    description:
      "Adds a tag to a contact. May trigger any sequence enrolled on tag-added.",
    inputSchema: z.object({ contactId: z.string(), tag: z.string() }),
    outputSchema: contactSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const contact = await addTagToContact(context.teamId, args.contactId, args.tag);
      if (!contact) return notFound();
      return omitInternal(contact);
    },
  }),

  dedicatedTool({
    name: "remove_contact_tag",
    operationId: "contacts.removeTag",
    risk: "write",
    description:
      "Removes a tag from a contact. May trigger any sequence enrolled on tag-removed.",
    inputSchema: z.object({ contactId: z.string(), tag: z.string() }),
    outputSchema: contactSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const contact = await removeTagFromContact(
        context.teamId,
        args.contactId,
        args.tag,
      );
      if (!contact) return notFound();
      return omitInternal(contact);
    },
  }),
];
