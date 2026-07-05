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

export function paginated<T extends z.ZodTypeAny>(item: T) {
    return z.object({ items: z.array(item), total: z.number() });
}

export function itemsList<T extends z.ZodTypeAny>(item: T) {
    return z.object({ items: z.array(item) });
}
