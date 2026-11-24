import { postalAddressSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  type GeneralSettings,
  getGeneralSettings,
  POSTAL_COUNTRY_INVALID,
  upsertGeneralSettings,
} from "../../settings/general/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { toolError } from "./responses";
import { generalSettingsSchema } from "./schemas";

function toPublicShape(settings: GeneralSettings) {
  return {
    postalAddress: settings.postalAddress,
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
      "Returns the team's general workspace settings. `postalAddress` is the physical postal address shown in the managed marketing footer, as separate fields; it is required for broadcasts and sequences. Returns defaults (null fields) when nothing has been saved yet.",
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
      "Updates the team's general workspace settings. Omitted fields are left unchanged. `postalAddress` is the physical postal address shown in the managed marketing footer and required for broadcasts and sequences: `line1` (street), optional `line2`, `city`, `region` and `postalCode`, and `country` as an uppercase ISO 3166-1 alpha-2 code. `null` clears it. Errors: `postal_country_invalid`.",
    inputSchema: z.object({
      postalAddress: postalAddressSchema
        .nullable()
        .optional()
        .describe(
          "The address as separate fields; country is an uppercase ISO 3166-1 alpha-2 code such as GB. Omit to keep unchanged; null clears it.",
        ),
    }),
    outputSchema: generalSettingsSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        return toPublicShape(await upsertGeneralSettings(context.teamId, args));
      } catch (err) {
        if (!(err instanceof Error) || err.message !== POSTAL_COUNTRY_INVALID)
          throw err;
        return toolError("validation_failed", {
          reason: POSTAL_COUNTRY_INVALID,
          message:
            "postalAddress.country must be a current ISO 3166-1 alpha-2 code, such as GB or US.",
        });
      }
    },
  }),
];
