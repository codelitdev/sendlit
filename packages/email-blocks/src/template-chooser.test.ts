import { describe, expect, it } from "vitest";
import { filterTemplatesForPurpose } from "./template-chooser";

describe("TemplateChooser purpose boundary", () => {
    it("defensively removes incompatible templates", () => {
        const items = [
            { templateId: "marketing", purpose: "marketing" as const },
            {
                templateId: "transactional",
                purpose: "transactional" as const,
            },
        ];

        expect(
            filterTemplatesForPurpose(items, "marketing").map(
                ({ templateId }) => templateId,
            ),
        ).toEqual(["marketing"]);
        expect(
            filterTemplatesForPurpose(items, "transactional").map(
                ({ templateId }) => templateId,
            ),
        ).toEqual(["transactional"]);
    });
});
