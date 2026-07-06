import { z } from "zod";

/** General (non-ESP) per-team workspace settings — a per-team singleton
 * (get/upsert, never a list), addressed via `/settings/general` like the ESP
 * settings, so no id fields are exposed. */
export const generalSettingsSchema = z.object({
    /** Physical postal address rendered in email footers
     * (CAN-SPAM/GDPR requirement). */
    mailingAddress: z.string().nullable(),
    updatedAt: z.string().nullable().optional(),
});

export const updateGeneralSettingsBodySchema = z.object({
    /** Send an empty string to clear the mailing address. */
    mailingAddress: z.string().optional(),
});
