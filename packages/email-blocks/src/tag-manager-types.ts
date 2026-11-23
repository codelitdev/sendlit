/**
 * The shapes of SendLit's `/tags` endpoints, declared here rather than
 * imported from the private `@sendlit/api-contract` so hosts get complete
 * types from the published package. `tag-manager-types.test.ts` checks they
 * match the contract.
 */

/** A tag in use, with how many contacts carry it. */
export interface TagSummary {
  tag: string;
  contactCount: number;
}

/** Where a broadcast or sequence uses a tag. */
export type TagSequenceUsage = "filter" | "exclude_filter" | "trigger" | "email_action";

/** Everything outside contacts that names the tag. */
export interface TagReferences {
  tag: string;
  contactCount: number;
  segments: { segmentId: string; name: string }[];
  sequences: {
    sequenceId: string;
    title: string;
    type: "broadcast" | "sequence";
    status: string;
    usages: TagSequenceUsage[];
  }[];
  signupForms: { formId: string; name: string }[];
}

export interface RenameTagResult {
  tag: string;
  previousTag: string;
  contactsUpdated: number;
  segmentsUpdated: number;
  sequencesUpdated: number;
  signupFormsUpdated: number;
}

export interface DeleteTagResult {
  tag: string;
  contactsUpdated: number;
  references: TagReferences;
}
