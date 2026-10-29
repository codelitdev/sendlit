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
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import {
  AUTH_ERROR,
  errorResult,
  INTERNAL_ERROR,
  jsonResult,
  NOT_FOUND,
} from "./responses";

const tagInput = { tag: z.string().min(1).describe("The tag, exactly as stored") };

export function registerTagTools(server: McpToolRegistrar): void {
  server.registerTool(
    "list_tags",
    {
      description:
        "Lists every tag carried by at least one of the team's contacts, sorted by name, with how many contacts carry it.",
      outputSchema: z.object({ items: z.array(tagSummarySchema) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        return jsonResult({ items: await listTags(teamId) });
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "get_tag_references",
    {
      description:
        "Shows how many contacts carry a tag and which segments, broadcasts, sequences (audience filters, tag triggers, email tag actions) and signup forms name it. Check it before deleting or renaming a tag.",
      inputSchema: tagInput,
      outputSchema: tagReferencesSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        return jsonResult(await getTagReferences(teamId, args.tag));
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "rename_tag",
    {
      description:
        "Renames a tag on every contact and in the segments, broadcast and sequence filters and tag triggers, sequence email tag actions and signup forms that name it. Renaming onto an existing tag merges the two. Sent broadcasts keep their original filters. Doesn't trigger tag-added or tag-removed sequences.",
      inputSchema: {
        ...tagInput,
        name: z.string().trim().min(1).describe("The tag's new name"),
      },
      outputSchema: renameTagResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const result = await renameTag(teamId, args.tag, args.name);
        if (result === "tag_not_found") return NOT_FOUND;
        if (result === "tag_unchanged") return errorResult("tag_unchanged");
        return jsonResult(result);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );

  server.registerTool(
    "delete_tag",
    {
      description:
        "Removes a tag from every contact of the team. This can't be undone. Segments, filters, triggers, email actions and signup forms that name the tag are left unchanged and returned in `references`: a filter on a deleted tag matches nobody, and a trigger or form can add the tag again. Call get_tag_references first and confirm with the user. Doesn't trigger tag-removed sequences.",
      inputSchema: tagInput,
      outputSchema: deleteTagResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        const result = await deleteTag(teamId, args.tag);
        if (!result) return NOT_FOUND;
        return jsonResult(result);
      } catch {
        return INTERNAL_ERROR;
      }
    },
  );
}
