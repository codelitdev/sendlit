import { z } from "zod";
import {
  type GeneralSettings,
  getGeneralSettings,
  upsertGeneralSettings,
} from "../../settings/general/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { generalSettingsSchema } from "./schemas";

function toPublicShape(settings: GeneralSettings) {
  return {
    mailingAddress: settings.mailingAddress,
    updatedAt: settings.updatedAt,
  };
}

export const generalSettingsTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_general_settings",
    title: "Get General Settings",
    operationId: "settings.general.get",
    risk: "read",
    description:
      "Returns the team's general workspace settings. The mailing address is used in the managed marketing footer and is required for broadcasts and sequences. Returns defaults (null fields) when nothing has been saved yet.",
    inputSchema: z.object({}),
    outputSchema: generalSettingsSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      return toPublicShape(await getGeneralSettings(context.teamId));
    },
  }),

  dedicatedTool({
    name: "update_general_settings",
    title: "Update General Settings",
    operationId: "settings.general.update",
    risk: "write",
    description:
      "Updates the team's general workspace settings. Omitted fields are left unchanged; send an empty string to clear a field. `mailingAddress` is the physical postal address rendered in the managed marketing footer and required for broadcasts and sequences.",
    inputSchema: z.object({
      mailingAddress: z
        .string()
        .optional()
        .describe("Omit to keep unchanged; empty string clears it"),
    }),
    outputSchema: generalSettingsSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      return toPublicShape(await upsertGeneralSettings(context.teamId, args));
    },
  }),
];
