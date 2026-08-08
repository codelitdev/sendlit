import { describe, expect, it } from "vitest";
import { defaultEmail } from "./default-email";
import { normalizeEmail } from "./normalize-email";

describe("normalizeEmail", () => {
    it("repairs a legacy document missing the link typography section", () => {
        const { link: _link, ...typography } = defaultEmail.style.typography;
        const { border: _border, ...colors } = defaultEmail.style.colors;

        const normalized = normalizeEmail({
            ...defaultEmail,
            style: {
                ...defaultEmail.style,
                colors: colors as typeof defaultEmail.style.colors,
                typography: {
                    ...typography,
                    button: { fontSize: "15px" },
                } as unknown as typeof defaultEmail.style.typography,
            },
        });

        expect(normalized.style.typography.link).toEqual(
            defaultEmail.style.typography.link,
        );
        expect(normalized.style.colors.border).toBe(
            defaultEmail.style.colors.border,
        );
        expect(normalized.style.typography).not.toHaveProperty("button");
    });

    it("keeps only supported email metadata for legacy documents", () => {
        const normalized = normalizeEmail({
            ...defaultEmail,
            meta: {
                previewText: "A preview",
                subject: "Legacy subject",
                utm: {
                    source: "newsletter",
                    medium: "email",
                    campaign: "launch",
                },
            } as typeof defaultEmail.meta,
        });

        expect(normalized.meta).toEqual({
            previewText: "A preview",
            utm: {
                source: "newsletter",
                medium: "email",
                campaign: "launch",
            },
        });
    });
});
