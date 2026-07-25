import { describe, expect, it } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import { defaultTemplateEmail } from "./default-content";

describe("defaultTemplateEmail", () => {
    it("includes one final managed footer required for publishing", () => {
        expect(
            defaultTemplateEmail.content.filter(
                (block) => block.blockType === "footer",
            ),
        ).toHaveLength(1);
        expect(defaultTemplateEmail.content.at(-1)?.blockType).toBe("footer");
    });

    it("does not mutate the lower-level editor default content", () => {
        expect(defaultTemplateEmail).not.toBe(defaultEmail);
        expect(
            defaultEmail.content.some((block) => block.blockType === "footer"),
        ).toBe(false);
    });

    it("retains the shared editor style while replacing only starter content", () => {
        expect(defaultTemplateEmail.style).toBe(defaultEmail.style);
        expect(defaultTemplateEmail.content).not.toBe(defaultEmail.content);
        expect(defaultTemplateEmail.content.length).toBeGreaterThan(0);
    });
});
