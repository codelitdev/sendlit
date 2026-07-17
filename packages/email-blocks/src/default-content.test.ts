import { describe, expect, it } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import { defaultTemplateEmail } from "./default-content";

describe("defaultTemplateEmail", () => {
    it("includes the compliance merge tags required for publishing", () => {
        const serialized = JSON.stringify(defaultTemplateEmail);

        expect(serialized).toContain("{{address}}");
        expect(serialized).toContain("{{unsubscribe_link}}");
    });

    it("does not mutate the lower-level editor default content", () => {
        expect(defaultTemplateEmail).not.toBe(defaultEmail);
        expect(JSON.stringify(defaultEmail)).not.toContain(
            "{{unsubscribe_link}}",
        );
    });

    it("retains the shared editor style while replacing only starter content", () => {
        expect(defaultTemplateEmail.style).toBe(defaultEmail.style);
        expect(defaultTemplateEmail.content).not.toBe(defaultEmail.content);
        expect(defaultTemplateEmail.content.length).toBeGreaterThan(0);
    });
});
