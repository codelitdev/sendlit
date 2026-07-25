import { describe, expect, it } from "vitest";
import { SYSTEM_TEMPLATES } from "./system-templates";
import {
    getRequiredTemplateVariables,
    validateTemplateContent,
} from "./validation";

describe("system template catalog", () => {
    it("contains valid purpose-specific content with discovered requirements", () => {
        for (const template of SYSTEM_TEMPLATES) {
            expect(() =>
                validateTemplateContent(template.content, template.purpose),
            ).not.toThrow();
            expect(template.requiredVariables).toEqual(
                getRequiredTemplateVariables(
                    template.content,
                    template.purpose,
                ),
            );
        }
    });

    it("keeps transactional variable metadata aligned with template content", () => {
        for (const template of SYSTEM_TEMPLATES.filter(
            ({ purpose }) => purpose === "transactional",
        )) {
            expect(
                (template.variableDefinitions ?? [])
                    .map(({ path }) => path)
                    .sort(),
            ).toEqual(template.requiredVariables);
        }
    });

    it("offers the approved transactional starters", () => {
        expect(
            SYSTEM_TEMPLATES.filter(
                ({ purpose }) => purpose === "transactional",
            ).map(({ templateId }) => templateId),
        ).toEqual([
            "system:transactional:otp",
            "system:transactional:magic-link",
            "system:transactional:password-reset",
            "system:transactional:verify-email",
            "system:transactional:invitation",
            "system:transactional:receipt",
            "system:transactional:payment",
            "system:transactional:security-alert",
            "system:transactional:blank",
        ]);
    });
});
