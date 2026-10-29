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
import {
  contactDeliveryListSchema,
  contactListSchema,
  contactSchema,
  successMessageSchema,
} from "./schemas";

export function registerContactTools(server: McpToolRegistrar): void {
  server.registerTool(
    "import_contacts",
    {
      description:
        "Imports up to 1000 contacts per call from another platform's export (beehiiv, Mailchimp, Substack, Kit, ...), matched by email. Pass each row's source status as-is (e.g. Active, Paused, Inactive, Pending, unsubscribed, cleaned): a status only gets stricter, so an import never re-subscribes anyone, bounced/complained rows are imported unsubscribed and suppressed, and paused contacts get the `paused` tag. Tags and custom fields merge into existing contacts and an earlier createdAt is kept. Imports don't trigger sequences. Returns created/updated/unchanged counts and the skipped rows with reasons.",
      inputSchema: importContactsBodySchema.shape,
      outputSchema: importContactsResultSchema,
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
        return jsonResult(
          await importContacts({ teamId, userId: getAuthUser(extra)?.id, ...args }),
        );
      } catch (error) {
        if (isPlanGateError(error)) return planGateResult(error);
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "export_contacts",
    {
      description:
        "Exports every contact, or those matching a saved segment and/or inline filter, as CSV text: email, name, status (subscribed/unsubscribed/bounced/complained), tags, created_at, suppression_reason, then one column per custom field.",
      inputSchema: {
        segmentId: z.string().optional().describe("Only export this saved segment"),
        filter: contactFilterSchema
          .optional()
          .describe("Inline contact filter; combines with segmentId using AND"),
      },
      outputSchema: z.object({ csv: z.string(), contacts: z.number().int() }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const filters: ContactFilterWithAggregator[] = [];
      if (args.segmentId) {
        const segment = await getSegment(args.segmentId);
        if (!segment || segment.teamId !== teamId) return NOT_FOUND;
        const parsed = contactFilterSchema.safeParse(segment.filter);
        if (!parsed.success) return INTERNAL_ERROR;
        filters.push(parsed.data as ContactFilterWithAggregator);
      }
      if (args.filter) filters.push(args.filter);
      const { csv, count } = await exportContactsCsv({
        teamId,
        filter: filters.length ? filters : undefined,
      });
      return jsonResult({ csv, contacts: count });
    },
  );

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
          const parsedSegmentFilter = contactFilterSchema.safeParse(segment.filter);
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
            excludeFilter: args.excludeFilter,
            offset: args.offset,
          }),
          countContacts(teamId, {
            searchText: args.q,
            filter,
            excludeFilter: args.excludeFilter,
          }),
        ]);
        return jsonResult({
          items: items.map((item) => omitInternal(item)),
          total,
        });
      } catch (error) {
        if (isPlanGateError(error)) return planGateResult(error);
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
        const deliveries = await getDeliveriesByContact(teamId, contact.id);
        return jsonResult({ items: deliveries });
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
        if (isPlanGateError(err)) return planGateResult(err);
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
      } catch (error) {
        if (isPlanGateError(error)) return planGateResult(error);
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
        const contact = await addTagToContact(teamId, args.contactId, args.tag);
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
        const contact = await removeTagFromContact(teamId, args.contactId, args.tag);
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
      description: "Permanently deletes a contact. This action cannot be undone.",
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
        await deleteContact(teamId, args.contactId, getAuthUser(extra)?.id ?? null);
        return jsonResult({ message: "Contact deleted." });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "preview_delete_contacts",
    {
      description:
        "Counts the contacts delete_contacts would remove, and how many of them are unsubscribed, without deleting anything. Select either contactIds or match (q, segmentId and filter, combined with AND; {} is every contact). Pass the count to delete_contacts as expectedCount.",
      inputSchema: contactSelectionObjectSchema.shape,
      outputSchema: z.object({
        count: z.number().int(),
        unsubscribed: z.number().int(),
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
      const parsed = contactSelectionSchema.safeParse(args);
      if (!parsed.success)
        return errorResult("Pass exactly one of contactIds or match.");
      try {
        const resolved = await selectionCondition(teamId, parsed.data);
        if ("error" in resolved) {
          return resolved.error === "segment_not_found"
            ? NOT_FOUND
            : errorResult(resolved.error);
        }
        return jsonResult(await countSelection(resolved.condition));
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "delete_contacts",
    {
      description:
        "Permanently deletes contacts in bulk: up to 1000 contactIds, or every contact matching match (q, segmentId, filter; {} is every contact). Call preview_delete_contacts first and confirm the count with the user; with match, expectedCount is required and nothing is deleted if the live count differs (count_changed). Up to 1000 contacts are deleted immediately; larger selections run in the background — poll get_contact_deletion with the returned deletionId. Deleting doesn't trigger sequences. Unsubscribed contacts' addresses are added to the suppression list so they are never mailed again. Delivery logs and suppressions keep the address, so this is not a full privacy erasure. Cannot be undone.",
      inputSchema: deleteContactsObjectSchema.shape,
      outputSchema: contactDeletionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const parsed = deleteContactsBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          parsed.error.issues.map((issue) => issue.message).join("; "),
        );
      }
      const { expectedCount, ...selection } = parsed.data;
      try {
        const result = await startContactDeletion({
          teamId,
          selection,
          expectedCount,
          actorUserId: getAuthUser(extra)?.id ?? null,
        });
        if (result.status === 404) return NOT_FOUND;
        if (result.status === 400 || result.status === 409) {
          return {
            ...errorResult(JSON.stringify(result.body)),
            structuredContent: result.body,
          };
        }
        return jsonResult(result.body);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_contact_deletion",
    {
      description:
        "Returns the progress of a background delete_contacts run: status (queued, running, completed, failed), count, deleted and suppressed. Kept for 24 hours after it finishes.",
      inputSchema: {
        deletionId: z.string().describe("deletionId from delete_contacts"),
      },
      outputSchema: contactDeletionSchema,
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
        const deletion = await getContactDeletion(teamId, args.deletionId);
        if (!deletion) return NOT_FOUND;
        return jsonResult(deletion);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );
}
