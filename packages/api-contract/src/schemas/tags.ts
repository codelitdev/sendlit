import { z } from "zod";

/** A tag in use by the team, with how many contacts carry it. */
export const tagSummarySchema = z.object({
  tag: z.string(),
  contactCount: z.number().int(),
});

/** Where a sequence or broadcast uses a tag. */
export const tagSequenceUsageSchema = z.enum([
  "filter",
  "exclude_filter",
  "trigger",
  "email_action",
]);

/** Everything outside contacts that names the tag. Deleting a tag leaves
 * these untouched, so they are listed for the caller to review first. */
export const tagReferencesSchema = z.object({
  tag: z.string(),
  contactCount: z.number().int(),
  segments: z.array(z.object({ segmentId: z.string(), name: z.string() })),
  sequences: z.array(
    z.object({
      sequenceId: z.string(),
      title: z.string(),
      type: z.enum(["broadcast", "sequence"]),
      status: z.string(),
      usages: z.array(tagSequenceUsageSchema),
    }),
  ),
  signupForms: z.array(z.object({ formId: z.string(), name: z.string() })),
});

export const renameTagBodySchema = z.object({
  name: z.string().trim().min(1).describe("The tag's new name"),
});

export const renameTagResultSchema = z.object({
  tag: z.string(),
  previousTag: z.string(),
  contactsUpdated: z.number().int(),
  segmentsUpdated: z.number().int(),
  sequencesUpdated: z.number().int(),
  signupFormsUpdated: z.number().int(),
});

export const deleteTagResultSchema = z.object({
  tag: z.string(),
  contactsUpdated: z.number().int(),
  references: tagReferencesSchema,
});

export type TagSummary = z.infer<typeof tagSummarySchema>;
export type TagReferences = z.infer<typeof tagReferencesSchema>;
export type RenameTagResult = z.infer<typeof renameTagResultSchema>;
export type DeleteTagResult = z.infer<typeof deleteTagResultSchema>;
