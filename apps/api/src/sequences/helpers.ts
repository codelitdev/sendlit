import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { rules } from "../db/schema";
import {
    defaultEmail,
    type Email,
    type EmailBlock,
} from "@sendlit/email-editor";
import { responses } from "../config/strings";
import { createFooterEmailBlock } from "@sendlit/email-blocks/footer";
import {
    TemplateValidationError,
    validateTemplateContent,
} from "../templates/validation";

/** Marketing starting content with the required managed footer. */
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
        createFooterEmailBlock(),
    ],
};

export function verifyMandatoryTags(emailContent: EmailBlock[]) {
    try {
        validateTemplateContent(
            { ...defaultEmailContent, content: emailContent },
            "marketing",
        );
    } catch (error) {
        if (!(error instanceof TemplateValidationError)) throw error;
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
    /** Internal `sequences.id` — `rules.sequenceId` is a uuid FK. */
    sequenceId: string;
    triggerType: string;
    triggerData?: string | null;
    eventDateInMillis?: number | null;
}) {
    await db.insert(rules).values({
        teamId,
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
    /** Internal `sequences.id`. */
    sequenceId: string;
}) {
    await db
        .delete(rules)
        .where(and(eq(rules.teamId, teamId), eq(rules.sequenceId, sequenceId)));
}
