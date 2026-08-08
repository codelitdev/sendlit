import { z } from "zod";

export const errorSchema = z.object({ error: z.string() });

export const successMessageSchema = z.object({ message: z.string() });

/** Matches `packages/email-editor`'s `Email`/`EmailBlock`/`EmailStyle` shape
 * (kept loose \u2014 `Record<string, any>` \u2014 same as the runtime validators this
 * replaces, since block/style settings are intentionally free-form). */
export const emailContentSchema = z.object({
    style: z.record(z.any()),
    meta: z.record(z.any()),
    content: z.array(z.record(z.any())),
});

const cssColorSchema = z
    .string()
    .regex(
        /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i,
        "Expected a hex color",
    );

const pixelSchema = z
    .string()
    .regex(/^\d+(?:\.\d+)?px$/, "Expected a pixel value such as 16px");

const typographySectionSchema = z.object({}).passthrough();

const emailStyleInputSchema = z
    .object({
        colors: z
            .object({
                background: cssColorSchema,
                foreground: cssColorSchema,
                border: cssColorSchema,
                accent: cssColorSchema,
                accentForeground: cssColorSchema,
            })
            .strict(),
        typography: z
            .object({
                header: typographySectionSchema,
                text: typographySectionSchema,
                link: typographySectionSchema,
            })
            .strict(),
        interactives: z
            .object({
                button: z
                    .object({
                        padding: z
                            .object({
                                x: pixelSchema.optional(),
                                y: pixelSchema.optional(),
                            })
                            .optional(),
                        border: z
                            .object({
                                width: pixelSchema.optional(),
                                radius: pixelSchema.optional(),
                                style: z.string().min(1).optional(),
                            })
                            .optional(),
                    })
                    .passthrough(),
                link: z
                    .object({
                        padding: z
                            .object({
                                x: pixelSchema.optional(),
                                y: pixelSchema.optional(),
                            })
                            .optional(),
                    })
                    .passthrough(),
            })
            .strict(),
        structure: z
            .object({
                page: z
                    .object({
                        background: cssColorSchema.optional(),
                        foreground: cssColorSchema.optional(),
                        width: pixelSchema.optional(),
                        marginY: pixelSchema.optional(),
                        borderWidth: pixelSchema.optional(),
                        borderStyle: z.string().min(1).optional(),
                        borderRadius: pixelSchema.optional(),
                    })
                    .strict(),
                section: z
                    .object({
                        padding: z
                            .object({
                                x: pixelSchema.optional(),
                                y: pixelSchema.optional(),
                            })
                            .optional(),
                    })
                    .strict(),
            })
            .strict(),
    })
    .strict();

const blockBaseSchema = z.object({
    id: z.string().optional(),
    settings: z.record(z.any()),
});

const emailBlockInputSchema = z.discriminatedUnion("blockType", [
    blockBaseSchema.extend({
        blockType: z.literal("text"),
        settings: z.object({ content: z.string() }).passthrough(),
    }),
    blockBaseSchema.extend({
        blockType: z.literal("link"),
        settings: z
            .object({ text: z.string(), url: z.string().min(1) })
            .passthrough(),
    }),
    blockBaseSchema.extend({
        blockType: z.literal("image"),
        settings: z.object({ src: z.string().min(1) }).passthrough(),
    }),
    blockBaseSchema.extend({ blockType: z.literal("separator") }),
    blockBaseSchema.extend({ blockType: z.literal("footer") }),
]);

const emailMetaInputSchema = z
    .object({
        previewText: z.string().optional(),
        utm: z
            .object({
                source: z.string(),
                medium: z.string(),
                campaign: z.string(),
            })
            .strict()
            .optional(),
    })
    .strict();

/**
 * Write-time email document contract. Keep `emailContentSchema` permissive
 * for reads so pre-validation legacy documents remain accessible for repair.
 */
export const emailContentInputSchema = z.object({
    style: emailStyleInputSchema,
    meta: emailMetaInputSchema,
    content: z.array(emailBlockInputSchema),
});

export function paginated<T extends z.ZodTypeAny>(item: T) {
    return z.object({ items: z.array(item), total: z.number() });
}

export function itemsList<T extends z.ZodTypeAny>(item: T) {
    return z.object({ items: z.array(item) });
}
