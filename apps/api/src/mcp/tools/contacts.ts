import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addTagToContact,
  countContacts,
  createContact,
  deleteContact,
  getContactByContactId,
  listContacts,
  removeTagFromContact,
  updateContact,
} from "../../contacts/queries";
import { AUTH_ERROR, INTERNAL_ERROR, NOT_FOUND, jsonResult } from "./responses";
import {
  contactListSchema,
  contactSchema,
  successMessageSchema,
} from "./schemas";
import { getTeamId } from "./auth";

export function registerContactTools(server: McpServer): void {
  server.registerTool(
    "list_contacts",
    {
      description:
        "Returns a paginated list of contacts (subscribers), optionally filtered by a search term matching email or name.",
      inputSchema: {
        q: z.string().optional().describe("Search by email or name"),
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
        const [items, total] = await Promise.all([
          listContacts({ teamId, searchText: args.q, offset: args.offset }),
          countContacts(teamId),
        ]);
        return jsonResult({ items, total });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_contact",
    {
      description: "Returns a single contact by its contact ID.",
      inputSchema: { contactId: z.string().describe("Contact ID") },
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
        return jsonResult(contact);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "create_contact",
    {
      description:
        "Creates a contact (subscriber). If a contact with the same email already exists, the existing contact is returned instead. Any attributes beyond email and name (e.g. company, age, plan, role) must be passed as string key/value pairs in customFields.",
      inputSchema: {
        email: z.string().email().describe("Contact's email address"),
        name: z.string().optional().describe("Contact's display name"),
        tags: z.array(z.string()).optional().describe("Initial tags"),
        customFields: z
          .record(z.string())
          .optional()
          .describe(
            "Arbitrary string key/value attributes such as company, age, plan, role, etc. Convert all non-email/name contact attributes to string values here.",
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
        return jsonResult(contact);
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
        "Updates a contact's name, tags, subscription, active status, or custom fields. Any attributes beyond the named fields (e.g. company, age, plan, role) must be passed as string key/value pairs in customFields. customFields replaces all existing custom fields — include any you want to keep.",
      inputSchema: {
        contactId: z.string().describe("Contact ID"),
        name: z.string().optional(),
        active: z.boolean().optional(),
        subscribedToUpdates: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        customFields: z.record(z.string()).optional().describe("Custom key/value fields (replaces existing)"),
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
        return jsonResult(contact);
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
        const contact = await addTagToContact(teamId, args.contactId, args.tag);
        if (!contact) return NOT_FOUND;
        return jsonResult(contact);
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
        return jsonResult(contact);
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
