import type { Email, EmailBlock } from "../types/email-editor";
import { defaultEmail } from "./default-email";

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Supplies editor defaults for documents written before the full write-time
 * contract existed. Persistence still validates complete documents; this is a
 * read-time compatibility boundary so a legacy row can be opened and repaired
 * instead of crashing the editor.
 */
export function normalizeEmail(content: Email): Email {
    const email = object(content);
    const style = object(email.style);
    const typography = object(style.typography);
    const interactives = object(style.interactives);
    const structure = object(style.structure);
    const button = object(interactives.button);
    const link = object(interactives.link);
    const section = object(structure.section);
    const meta = object(email.meta);
    const utm = object(meta.utm);
    const hasValidUtm = ["source", "medium", "campaign"].every(
        (key) => typeof utm[key] === "string",
    );

    return {
        ...defaultEmail,
        ...email,
        meta: {
            ...defaultEmail.meta,
            ...(typeof meta.previewText === "string"
                ? { previewText: meta.previewText }
                : {}),
            ...(hasValidUtm
                ? {
                      utm: {
                          source: utm.source as string,
                          medium: utm.medium as string,
                          campaign: utm.campaign as string,
                      },
                  }
                : {}),
        },
        style: {
            ...defaultEmail.style,
            colors: {
                ...defaultEmail.style.colors,
                ...object(style.colors),
            },
            typography: {
                ...defaultEmail.style.typography,
                header: {
                    ...defaultEmail.style.typography.header,
                    ...object(typography.header),
                },
                text: {
                    ...defaultEmail.style.typography.text,
                    ...object(typography.text),
                },
                link: {
                    ...defaultEmail.style.typography.link,
                    ...object(typography.link),
                },
            },
            interactives: {
                ...defaultEmail.style.interactives,
                button: {
                    ...defaultEmail.style.interactives.button,
                    ...button,
                    padding: {
                        ...defaultEmail.style.interactives.button.padding,
                        ...object(button.padding),
                    },
                    border: {
                        ...defaultEmail.style.interactives.button.border,
                        ...object(button.border),
                    },
                },
                link: {
                    ...defaultEmail.style.interactives.link,
                    ...link,
                    padding: {
                        ...defaultEmail.style.interactives.link.padding,
                        ...object(link.padding),
                    },
                },
            },
            structure: {
                ...defaultEmail.style.structure,
                page: {
                    ...defaultEmail.style.structure.page,
                    ...object(structure.page),
                },
                section: {
                    ...defaultEmail.style.structure.section,
                    ...section,
                    padding: {
                        ...defaultEmail.style.structure.section.padding,
                        ...object(section.padding),
                    },
                },
            },
        },
        content: Array.isArray(email.content)
            ? (email.content as EmailBlock[])
            : defaultEmail.content,
    } as Email;
}
