import type { PlatformErrorCode } from "@codelitdev/platform";
import {
  contactDeletionSchema,
  contactFilterSchema,
  contactSelectionObjectSchema,
  contactSelectionSchema,
  customFieldsSchema,
  deleteContactsBodySchema,
  deleteContactsObjectSchema,
  importContactsBodySchema,
  importContactsResultSchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import { countSelection, selectionCondition } from "../../contacts/bulk-delete";
import {
  getContactDeletion,
  startContactDeletion,
} from "../../contacts/deletion-queue";
import { exportContactsCsv } from "../../contacts/export";
import { importContacts } from "../../contacts/import";
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
import type { ContactFilterWithAggregator } from "../../contacts/segment";
import { getSegment } from "../../contacts/segments-queries";
import { omitInternal } from "../../utils/public";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, notFound, planGateError, toolError } from "./responses";
import {
  contactDeliveryListSchema,
  contactListSchema,
  contactSchema,
  successMessageSchema,
} from "./schemas";

const SELECTION_ERROR_CODES: Record<number, PlatformErrorCode> = {
  400: "validation_failed",
  404: "not_found",
  409: "conflict",
};

/** A bulk-delete refusal as REST returns it (`{ error, ...primitives }`):
 * the REST code becomes `reason`, and `count` and the like are kept. */
function selectionError(status: number, body: Record<string, unknown>) {
  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      continue;
    }
    details[key === "error" ? "reason" : key] = value as
      | string
      | number
      | boolean
      | null;
  }
  return toolError(SELECTION_ERROR_CODES[status] ?? "validation_failed", details);
}

export const contactTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "import_contacts",
    title: "Import Contacts",
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
    name: "export_contacts",
    title: "Export Contacts",
    operationId: "contacts.export",
    risk: "read",
    description:
      "Exports every contact, or those matching a saved segment and/or inline filter, as CSV text: email, name, status (subscribed/unsubscribed/bounced/complained), tags, created_at, suppression_reason, then one column per custom field.",
    inputSchema: z.object({
      segmentId: z.string().optional().describe("Only export this saved segment"),
      filter: contactFilterSchema
        .optional()
        .describe("Inline contact filter; combines with segmentId using AND"),
    }),
    outputSchema: z.object({ csv: z.string(), contacts: z.number().int() }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const filters: ContactFilterWithAggregator[] = [];
      if (args.segmentId) {
        const segment = await getSegment(args.segmentId);
        if (!segment || segment.teamId !== context.teamId) return notFound();
        const parsed = contactFilterSchema.safeParse(segment.filter);
        if (!parsed.success) throw new Error("Saved segment filter is invalid");
        filters.push(parsed.data as ContactFilterWithAggregator);
      }
      if (args.filter) filters.push(args.filter as ContactFilterWithAggregator);
      const { csv, count } = await exportContactsCsv({
        teamId: context.teamId,
        filter: filters.length ? filters : undefined,
      });
      return { csv, contacts: count };
    },
  }),

  dedicatedTool({
    name: "list_contacts",
    title: "List Contacts",
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
    title: "Get Contact",
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
    name: "get_contact_deliveries",
    title: "Get Contact Deliveries",
    operationId: "contacts.deliveries",
    risk: "read",
    description:
      "Returns the broadcasts and sequence emails a contact has received, newest first.",
    inputSchema: z.object({ contactId: z.string().describe("Contact ID") }),
    outputSchema: contactDeliveryListSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const contact = await getContactByContactId(args.contactId);
      if (!contact || contact.teamId !== context.teamId) return notFound();
      return { items: await getDeliveriesByContact(context.teamId, contact.id) };
    },
  }),

  dedicatedTool({
    name: "create_contact",
    title: "Create Contact",
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
    title: "Update Contact",
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
    title: "Add Contact Tag",
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
    title: "Remove Contact Tag",
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
  dedicatedTool({
    name: "delete_contact",
    title: "Delete Contact",
    operationId: "contacts.remove",
    risk: "destructive",
    description: "Permanently deletes a contact. This action cannot be undone.",
    inputSchema: z.object({ contactId: z.string() }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      await deleteContact(context.teamId, args.contactId, context.user?.id ?? null);
      return { message: "Contact deleted." };
    },
  }),

  dedicatedTool({
    name: "preview_delete_contacts",
    title: "Preview Contact Deletion",
    operationId: "contacts.previewBulkDelete",
    risk: "read",
    description:
      "Counts the contacts delete_contacts would remove, and how many of them are unsubscribed, without deleting anything. Select either contactIds or match (q, segmentId and filter, combined with AND; {} is every contact). Pass the count to delete_contacts as expectedCount.",
    inputSchema: contactSelectionObjectSchema,
    outputSchema: z.object({
      count: z.number().int(),
      unsubscribed: z.number().int(),
    }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const parsed = contactSelectionSchema.safeParse(args);
      if (!parsed.success) {
        return toolError("validation_failed", {
          reason: "invalid_selection",
          message: "Pass exactly one of contactIds or match.",
        });
      }
      const resolved = await selectionCondition(context.teamId, parsed.data);
      if ("error" in resolved) {
        return resolved.error === "segment_not_found"
          ? notFound()
          : toolError("validation_failed", { reason: resolved.error });
      }
      return await countSelection(resolved.condition);
    },
  }),

  dedicatedTool({
    name: "delete_contacts",
    title: "Delete Contacts",
    operationId: "contacts.bulkDelete",
    risk: "destructive",
    description:
      "Permanently deletes contacts in bulk: up to 1000 contactIds, or every contact matching match (q, segmentId, filter; {} is every contact). Call preview_delete_contacts first and confirm the count with the user; with match, expectedCount is required and nothing is deleted if the live count differs (count_changed). Up to 1000 contacts are deleted immediately; larger selections run in the background — poll get_contact_deletion with the returned deletionId. Deleting doesn't trigger sequences. Unsubscribed contacts' addresses are added to the suppression list so they are never mailed again. Delivery logs and suppressions keep the address, so this is not a full privacy erasure. Cannot be undone.",
    inputSchema: deleteContactsObjectSchema,
    outputSchema: contactDeletionSchema,
    annotations: { idempotentHint: false, openWorldHint: false },
    async handler({ context, args }) {
      // `confirm` is the kit's destructive-action guard, not part of the body.
      const { confirm: _confirm, ...body } = args as typeof args & {
        confirm?: boolean;
      };
      const parsed = deleteContactsBodySchema.safeParse(body);
      if (!parsed.success) {
        return toolError("validation_failed", {
          reason: "invalid_selection",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }
      const { expectedCount, ...selection } = parsed.data;
      const result = await startContactDeletion({
        teamId: context.teamId,
        selection,
        expectedCount,
        actorUserId: context.user?.id ?? null,
      });
      if (result.status === 404) return notFound();
      if (result.status === 400 || result.status === 409) {
        return selectionError(result.status, result.body as Record<string, unknown>);
      }
      return result.body;
    },
  }),

  dedicatedTool({
    name: "get_contact_deletion",
    title: "Get Contact Deletion",
    operationId: "contacts.bulkDeleteStatus",
    risk: "read",
    description:
      "Returns the progress of a background delete_contacts run: status (queued, running, completed, failed), count, deleted and suppressed. Kept for 24 hours after it finishes.",
    inputSchema: z.object({
      deletionId: z.string().describe("deletionId from delete_contacts"),
    }),
    outputSchema: contactDeletionSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const deletion = await getContactDeletion(context.teamId, args.deletionId);
      return deletion ?? notFound();
    },
  }),
];
