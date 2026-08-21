import { describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import { createFooterEmailBlock } from "@sendlit/email-blocks/footer";

vi.mock("../observability/posthog", () => ({
    captureError: vi.fn(),
}));
vi.mock("../services/log", () => ({
    default: { error: vi.fn(), info: vi.fn() },
}));

import {
    appendTrackingPixel,
    appendTrackingPixelToHtml,
    findMissingTemplateVariables,
    mailingAddressAppearsInText,
    MissingTemplateVariablesError,
    renderEmailContent,
    transformLinksForClickTracking,
} from "./render";

describe("mail render helpers", () => {
    it("renders Liquid merge tags over email-editor content", async () => {
        const content = {
            ...defaultEmail,
            content: [
                {
                    blockType: "text" as const,
                    settings: {
                        content: "Hello {{ name }}",
                    },
                },
            ],
        };
        const html = await renderEmailContent({
            content,
            variables: { name: "Ada" },
        });
        expect(html).toContain("Hello Ada");
    });

    it("renders the shared managed footer from server-owned context", async () => {
        const content = {
            ...defaultEmail,
            content: [
                {
                    blockType: "text" as const,
                    settings: { content: "Hello {{ subscriber.name }}" },
                },
                createFooterEmailBlock(),
            ],
        };

        const html = await renderEmailContent({
            content,
            variables: {
                subscriber: { name: "Ada" },
                address: "123 Main Street, London",
                unsubscribe_link: "https://sendlit.test/unsubscribe/token",
            },
        });

        expect(html).toContain("Hello Ada");
        expect(html).toContain("123 Main Street, London");
        expect(html).toContain('href="https://sendlit.test/unsubscribe/token"');
    });

    it("renders multi-line mailing addresses without footer_render_failed", async () => {
        const content = {
            ...defaultEmail,
            content: [
                {
                    blockType: "text" as const,
                    settings: { content: "Hello" },
                },
                createFooterEmailBlock(),
            ],
        };

        const html = await renderEmailContent({
            content,
            variables: {
                address: "23 St Streets, Maine County\nNovark",
                unsubscribe_link: "https://sendlit.test/unsubscribe/token",
            },
        });

        expect(html).toContain("23 St Streets, Maine County");
        expect(html).toContain("Novark");
        expect(html).toMatch(/Maine County\s*<br\s*\/?>\s*Novark/i);
        expect(html).toContain('href="https://sendlit.test/unsubscribe/token"');
    });

    it("treats each non-empty mailing-address line as present in rendered text", () => {
        expect(
            mailingAddressAppearsInText(
                "23 St Streets, Maine CountyNovark Unsubscribe",
                "23 St Streets, Maine County\nNovark",
            ),
        ).toBe(true);
        expect(
            mailingAddressAppearsInText(
                "23 St Streets, Maine County Novark",
                "23 St Streets, Maine County\nNovark",
            ),
        ).toBe(true);
        expect(
            mailingAddressAppearsInText(
                "23 St Streets, Maine County",
                "23 St Streets, Maine County\nNovark",
            ),
        ).toBe(false);
    });

    it("refuses to render a managed footer without server-owned context", async () => {
        await expect(
            renderEmailContent({
                content: {
                    ...defaultEmail,
                    content: [createFooterEmailBlock()],
                },
                variables: {},
            }),
        ).rejects.toThrow("footer_render_context_required");
    });

    it("identifies missing required values while allowing defaults and guarded branches", () => {
        expect(
            findMissingTemplateVariables(
                [
                    "{{ otp }}",
                    "{{ customer.name }}",
                    '{{ first_name | default: "there" }}',
                    "{% if promotion %}{{ promotion.code }}{% endif %}",
                ].join(" "),
                {},
            ),
        ).toEqual(["customer.name", "otp"]);
    });

    it("validates only the Liquid branch that actually renders", () => {
        const source =
            "{% if promotion %}{{ promotion.code }}{% else %}{{ fallback }}{% endif %}";

        expect(
            findMissingTemplateVariables(source, {
                promotion: { code: "SAVE20" },
            }),
        ).toEqual([]);
        expect(
            findMissingTemplateVariables(source, {
                promotion: {},
                fallback: "No offer",
            }),
        ).toEqual(["promotion.code"]);
        expect(
            findMissingTemplateVariables(source, {
                fallback: "No offer",
            }),
        ).toEqual([]);
    });

    it("uses Liquid rather than JavaScript truthiness for direct guards", () => {
        expect(
            findMissingTemplateVariables(
                "{% if count %}{{ label }}{% endif %}",
                { count: 0 },
            ),
        ).toEqual(["label"]);
        expect(
            findMissingTemplateVariables(
                "{% if value %}{{ label }}{% endif %}",
                { value: "" },
            ),
        ).toEqual(["label"]);
    });

    it("fails rendering rather than silently blanking missing template values", async () => {
        const content = {
            ...defaultEmail,
            content: [
                {
                    blockType: "text" as const,
                    settings: { content: "Your code is {{ otp }}" },
                },
            ],
        };

        await expect(
            renderEmailContent({
                content,
                variables: {},
                requireVariables: true,
            }),
        ).rejects.toEqual(
            expect.objectContaining({
                name: "MissingTemplateVariablesError",
                message: "missing_template_variables",
                missingVariables: ["otp"],
            } satisfies Partial<MissingTemplateVariablesError>),
        );
    });

    it("appends open-tracking pixels and rewrites clickable links", () => {
        const withBlock = appendTrackingPixel(
            { ...defaultEmail, content: [] },
            "https://sendlit.test/px",
        );
        expect(withBlock.content.at(-1)).toMatchObject({
            blockType: "image",
            settings: { src: "https://sendlit.test/px" },
        });

        const marketingWithBlock = appendTrackingPixel(
            {
                ...defaultEmail,
                content: [
                    {
                        blockType: "text",
                        settings: { content: "Hello" },
                    },
                    createFooterEmailBlock(),
                ],
            },
            "https://sendlit.test/px",
        );
        expect(marketingWithBlock.content.at(-2)?.blockType).toBe("image");
        expect(marketingWithBlock.content.at(-1)?.blockType).toBe("footer");

        expect(
            appendTrackingPixelToHtml(
                "<html><body><p>Hi</p></body></html>",
                "https://sendlit.test/px",
            ),
        ).toContain('src="https://sendlit.test/px"');

        const tracked = transformLinksForClickTracking(
            `<a href="https://example.com/a">A</a>
             <a href="mailto:x@y.com">mail</a>
             <a href="https://sendlit.test/unsubscribe/t">unsub</a>
             <a href="https://example.com/b">B</a>`,
            (url, index) =>
                `https://track.test/${index}?u=${encodeURIComponent(url)}`,
        );
        expect(tracked).toContain(
            "https://track.test/0?u=https%3A%2F%2Fexample.com%2Fa",
        );
        expect(tracked).toContain("mailto:x@y.com");
        expect(tracked).toContain("/unsubscribe/t");
        expect(tracked).toContain(
            "https://track.test/3?u=https%3A%2F%2Fexample.com%2Fb",
        );
    });
});
