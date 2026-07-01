import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { rules } from "../db/schema";
import { generateUniqueId } from "../utils/id";
import {
  defaultEmail,
  type Email,
  type EmailBlock,
} from "@sendlit/email-editor";
import { responses } from "../config/strings";

/** Same starting content as CourseLit's `createSequence`, with the mandatory
 * unsubscribe/address merge tags baked in so `verifyMandatoryTags` passes. */
export const defaultEmailContent: Email = {
  ...defaultEmail,
  content: [
    {
      blockType: "text",
      settings: {
        content: "# Your Company Name\n\nThis is some paragraph text.",
        alignment: "left",
        fontSize: "24px",
      },
    },
    {
      blockType: "text",
      settings: {
        content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
        alignment: "center",
        fontSize: "12px",
        foregroundColor: "#64748b",
        paddingTop: "0px",
        paddingBottom: "0px",
      },
    },
  ],
};

export function verifyMandatoryTags(emailContent: EmailBlock[]) {
  const unsubscribeRegex = /{{\s*unsubscribe_link\s*}}/;
  const addressRegex = /{{\s*address\s*}}/;

  const hasUnsubscribeLink = emailContent.some(
    (block) =>
      block.settings && JSON.stringify(block.settings).match(unsubscribeRegex),
  );
  const hasAddress = emailContent.some(
    (block) =>
      block.settings && JSON.stringify(block.settings).match(addressRegex),
  );

  if (!hasUnsubscribeLink || !hasAddress) {
    throw new Error(responses.mandatory_tags_missing);
  }
}

export async function addRule({
  teamId,
  sequenceId,
  triggerType,
  triggerData,
  eventDateInMillis,
}: {
  teamId: string;
  sequenceId: string;
  triggerType: string;
  triggerData?: string | null;
  eventDateInMillis?: number | null;
}) {
  await db.insert(rules).values({
    teamId,
    ruleId: generateUniqueId(),
    event: triggerType,
    sequenceId,
    eventDateInMillis: eventDateInMillis ?? null,
    eventData: triggerData ?? null,
  });
}

export async function removeRule({
  teamId,
  sequenceId,
}: {
  teamId: string;
  sequenceId: string;
}) {
  await db
    .delete(rules)
    .where(and(eq(rules.teamId, teamId), eq(rules.sequenceId, sequenceId)));
}
