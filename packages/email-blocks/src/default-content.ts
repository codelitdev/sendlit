import { defaultEmail, type Email } from "@sendlit/email-editor";
import { createFooterEmailBlock } from "./footer";

/**
 * A starting point for new marketing templates/emails that already includes
 * the managed footer the API requires before a broadcast or sequence email can
 * be published. Prefer this over
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
        createFooterEmailBlock(),
    ],
};
