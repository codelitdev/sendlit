import type {
  DeleteTagResult,
  RenameTagResult,
  TagReferences,
} from "./tag-manager-types";

/** "1 contact", "2,500 contacts". */
export function plural(count: number, word: string, words = `${word}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : words}`;
}

/** "2 contacts and 1 segment", leaving out the zeros. */
export function listCounts(counts: [number, string, string?][]): string {
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, word, words]) => plural(count, word, words));
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** What a rename changed, for the notice under the list. */
export function renameNotice(result: RenameTagResult): string {
  return `Renamed ${result.previousTag} to ${result.tag} on ${listCounts([
    [result.contactsUpdated, "contact"],
    [result.segmentsUpdated, "segment"],
    [result.sequencesUpdated, "broadcast or sequence", "broadcasts or sequences"],
    [result.signupFormsUpdated, "signup form"],
  ])}.`;
}

/** What a delete changed, for the notice under the list. */
export function deleteNotice(result: DeleteTagResult): string {
  return `Deleted ${result.tag} from ${plural(result.contactsUpdated, "contact")}.`;
}

/** Segments, broadcasts, sequences and signup forms that still name the tag. */
export function referenceCount(references: TagReferences): number {
  return (
    references.segments.length +
    references.sequences.length +
    references.signupForms.length
  );
}

export const TAG_USAGE_LABELS: Record<
  TagReferences["sequences"][number]["usages"][number],
  string
> = {
  filter: "audience filter",
  exclude_filter: "exclusion filter",
  trigger: "trigger",
  email_action: "email tag action",
};
