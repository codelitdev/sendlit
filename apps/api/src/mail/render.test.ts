import { describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";

vi.mock("../observability/posthog", () => ({
    captureError: vi.fn(),
}));
vi.mock("../services/log", () => ({
    default: { error: vi.fn(), info: vi.fn() },
}));

import {
    appendTrackingPixel,
    appendTrackingPixelToHtml,
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

    it("appends open-tracking pixels and rewrites clickable links", () => {
        const withBlock = appendTrackingPixel(
            { ...defaultEmail, content: [] },
            "https://sendlit.test/px",
        );
        expect(withBlock.content.at(-1)).toMatchObject({
            blockType: "image",
            settings: { src: "https://sendlit.test/px" },
        });

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
