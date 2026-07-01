import { defaultEmail, type Email } from "@sendlit/email-editor";

/**
 * A starting point for new templates/emails that already includes the
 * `{{unsubscribe_link}}` and `{{address}}` merge tags the API requires before
 * a broadcast or sequence email can be published (see `verifyMandatoryTags`
 * in `apps/api/src/sequences/helpers.ts`). Prefer this over
 * `@sendlit/email-editor`'s bare `defaultEmail` when creating new templates.
 */
export const defaultTemplateEmail: Email = {
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
