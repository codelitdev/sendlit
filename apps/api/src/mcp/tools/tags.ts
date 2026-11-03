import {
  deleteTagResultSchema,
  renameTagResultSchema,
  tagReferencesSchema,
  tagSummarySchema,
} from "@sendlit/api-contract";
import { z } from "zod";
import {
  deleteTag,
  getTagReferences,
  listTags,
  renameTag,
} from "../../contacts/tags-queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";

const tagInput = { tag: z.string().min(1).describe("The tag, exactly as stored") };

export const tagTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_tags",
    title: "List Tags",
    operationId: "tags.list",
    risk: "read",
    description:
      "Lists every tag carried by at least one of the team's contacts, sorted by name, with how many contacts carry it.",
    inputSchema: z.object({}),
    outputSchema: z.object({ items: z.array(tagSummarySchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      return { items: await listTags(context.teamId) };
    },
  }),

  dedicatedTool({
    name: "get_tag_references",
    title: "Get Tag References",
    operationId: "tags.references",
    risk: "read",
    description:
      "Shows how many contacts carry a tag and which segments, broadcasts, sequences (audience filters, tag triggers, email tag actions) and signup forms name it. Check it before deleting or renaming a tag.",
    inputSchema: z.object(tagInput),
    outputSchema: tagReferencesSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      return await getTagReferences(context.teamId, args.tag);
    },
  }),

  dedicatedTool({
    name: "rename_tag",
    title: "Rename Tag",
    operationId: "tags.rename",
    risk: "write",
    description:
      "Renames a tag on every contact and in the segments, broadcast and sequence filters and tag triggers, sequence email tag actions and signup forms that name it. Renaming onto an existing tag merges the two. Sent broadcasts keep their original filters. Doesn't trigger tag-added or tag-removed sequences.",
    inputSchema: z.object({
      ...tagInput,
      name: z.string().trim().min(1).describe("The tag's new name"),
    }),
    outputSchema: renameTagResultSchema,
    annotations: { idempotentHint: false, openWorldHint: false },
    async handler({ context, args }) {
      const result = await renameTag(context.teamId, args.tag, args.name);
      if (result === "tag_not_found") return notFound();
      if (result === "tag_unchanged") {
        return toolError("validation_failed", {
          reason: "tag_unchanged",
          message: "The new name is the same as the current one.",
        });
      }
      return result;
    },
  }),

  dedicatedTool({
    name: "delete_tag",
    title: "Delete Tag",
    operationId: "tags.remove",
    risk: "destructive",
    description:
      "Removes a tag from every contact of the team. This can't be undone. Segments, filters, triggers, email actions and signup forms that name the tag are left unchanged and returned in `references`: a filter on a deleted tag matches nobody, and a trigger or form can add the tag again. Call get_tag_references first and confirm with the user. Doesn't trigger tag-removed sequences.",
    inputSchema: z.object(tagInput),
    outputSchema: deleteTagResultSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const result = await deleteTag(context.teamId, args.tag);
      return result ?? notFound();
    },
  }),
];
