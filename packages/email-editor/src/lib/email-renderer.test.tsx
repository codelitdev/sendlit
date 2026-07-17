import { describe, expect, it } from "vitest";
import { defaultEmail } from "./default-email";
import { renderEmailToHtml } from "./email-renderer";

describe("renderEmailToHtml", () => {
    it("renders preview text and the default block content", async () => {
        const html = await renderEmailToHtml({
            email: {
                ...defaultEmail,
                meta: { previewText: "Inbox preview" },
            },
        });

        expect(html).toContain("Inbox preview");
        expect(html).toContain("Your Company Name");
        expect(html).toContain("Visit Our Website");
    });

    it("adds UTM parameters without mutating the editor document", async () => {
        const email = structuredClone(defaultEmail);
        const link = email.content.find((block) => block.blockType === "link")!;
        link.settings.url = "https://example.com/offer?existing=1";

        const html = await renderEmailToHtml({
            email,
            utmParams: {
                source: "newsletter",
                medium: "email",
                campaign: "launch",
            },
        });

        expect(html).toContain("existing=1");
        expect(html).toContain("utm_source=newsletter");
        expect(html).toContain("utm_medium=email");
        expect(html).toContain("utm_campaign=launch");
        expect(link.settings.url).toBe("https://example.com/offer?existing=1");
    });

    it("preserves invalid link values rather than failing the whole render", async () => {
        const email = structuredClone(defaultEmail);
        const link = email.content.find((block) => block.blockType === "link")!;
        link.settings.url = "not a valid URL";

        const html = await renderEmailToHtml({
            email,
            utmParams: { source: "s", medium: "m", campaign: "c" },
        });

        expect(html).toContain("not a valid URL");
        expect(html).not.toContain("utm_source");
    });

    it("renders an explicit placeholder for unknown block types", async () => {
        const html = await renderEmailToHtml({
            email: {
                ...defaultEmail,
                content: [{ blockType: "future-block", settings: {} } as any],
            },
        });

        expect(html).toContain("Unknown block type:");
        expect(html).toContain("future-block");
    });

    it("returns safe error markup when a custom block throws", async () => {
        const brokenBlock = {
            metadata: { name: "broken" },
            block: () => {
                throw new Error("render exploded");
            },
        };
        const html = await renderEmailToHtml({
            email: {
                ...defaultEmail,
                content: [{ blockType: "broken", settings: {} } as any],
            },
            blocks: [brokenBlock],
        });

        expect(html).toContain("Error: render exploded");
    });
});
