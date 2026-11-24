import { postalAddressSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  type GeneralSettings,
  getGeneralSettings,
  POSTAL_ADDRESS_CONFLICT,
  POSTAL_COUNTRY_INVALID,
  upsertGeneralSettings,
} from "../../settings/general/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { toolError } from "./responses";
import { generalSettingsSchema } from "./schemas";

function toPublicShape(settings: GeneralSettings) {
  return {
    mailingAddress: settings.mailingAddress,
    postalAddress: settings.postalAddress,
    updatedAt: settings.updatedAt,
  };
}

/** The address codes REST answers 400 with; anything else is thrown. */
const ADDRESS_ERRORS: Record<string, string> = {
  [POSTAL_ADDRESS_CONFLICT]: "Send either mailingAddress or postalAddress, not both.",
  [POSTAL_COUNTRY_INVALID]:
    "postalAddress.country must be a current ISO 3166-1 alpha-2 code, such as GB or US.",
};

export const generalSettingsTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_general_settings",
    title: "Get General Settings",
    operationId: "settings.general.get",
    risk: "read",
    description:
      "Returns the team's general workspace settings. `mailingAddress` is the footer text of the managed marketing footer and is required for broadcasts and sequences; `postalAddress` holds the same address as separate fields when it was saved that way (null when it was saved as free text). Returns defaults (null fields) when nothing has been saved yet.",
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
      'Updates the team\'s general workspace settings. Omitted fields are left unchanged. The physical postal address rendered in the managed marketing footer (required for broadcasts and sequences) can be set either as separate fields in `postalAddress` (preferred; SendLit formats `mailingAddress` from it) or as free text in `mailingAddress` (which clears `postalAddress`), never both. `postalAddress: null` or `mailingAddress: ""` clears the address. Errors: `postal_address_conflict`, `postal_country_invalid`.',
    inputSchema: z.object({
      mailingAddress: z
        .string()
        .optional()
        .describe(
          "Free-text address. Omit to keep unchanged; empty string clears it. Can't be sent with postalAddress.",
        ),
      postalAddress: postalAddressSchema
        .nullable()
        .optional()
        .describe(
          "The address as separate fields; country is an uppercase ISO 3166-1 alpha-2 code. Omit to keep unchanged; null clears the address. Can't be sent with mailingAddress.",
        ),
    }),
    outputSchema: generalSettingsSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        return toPublicShape(await upsertGeneralSettings(context.teamId, args));
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        const message = ADDRESS_ERRORS[code];
        if (!message) throw err;
        return toolError("validation_failed", { reason: code, message });
      }
    },
  }),
];
