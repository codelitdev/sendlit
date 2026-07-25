import { describe, expect, it } from "vitest";
import { defaultEmail, type Email } from "@sendlit/email-editor";
import { createFooterEmailBlock } from "@sendlit/email-blocks/footer";
import {
    TemplateValidationError,
    getRequiredTemplateVariables,
    validateTemplateContent,
} from "./validation";

function content(text: string, purpose: "marketing" | "transactional"): Email {
    return {
        ...defaultEmail,
        content: [
            { blockType: "text", settings: { content: text } },
            ...(purpose === "marketing" ? [createFooterEmailBlock()] : []),
        ],
    };
}

describe("template content validation", () => {
    it("requires exactly one final footer for marketing content", () => {
        expect(() =>
            validateTemplateContent(content("Hello", "marketing"), "marketing"),
        ).not.toThrow();

        expect(() =>
            validateTemplateContent(
                content("Hello", "transactional"),
                "marketing",
            ),
        ).toThrowError(expect.objectContaining({ message: "footer_required" }));

        const misplaced = content("Hello", "marketing");
        misplaced.content.push({
            blockType: "text",
            settings: { content: "After footer" },
        });
        expect(() =>
            validateTemplateContent(misplaced, "marketing"),
        ).toThrowError(expect.objectContaining({ message: "footer_required" }));

        const duplicate = content("Hello", "marketing");
        duplicate.content.push(createFooterEmailBlock());
        expect(() =>
            validateTemplateContent(duplicate, "marketing"),
        ).toThrowError(expect.objectContaining({ message: "footer_required" }));
    });

    it("rejects managed footer content fields", () => {
        const email = content("Hello", "marketing");
        email.content.at(-1)!.settings.address = "Caller controlled";

        expect(() => validateTemplateContent(email, "marketing")).toThrowError(
            expect.objectContaining({
                message: "invalid_footer",
                variables: ["address"],
            } satisfies Partial<TemplateValidationError>),
        );
    });

    it("rejects invalid managed footer presentation values", () => {
        const email = content("Hello", "marketing");
        email.content.at(-1)!.settings = {
            alignment: "diagonal",
            fontSize: "large",
            foregroundColor: "red",
        };

        expect(() => validateTemplateContent(email, "marketing")).toThrowError(
            expect.objectContaining({
                message: "invalid_footer",
                variables: ["alignment", "fontSize", "foregroundColor"],
            } satisfies Partial<TemplateValidationError>),
        );
    });

    it("rejects footer and reserved marketing variables transactionally", () => {
        expect(() =>
            validateTemplateContent(
                content("Hello", "marketing"),
                "transactional",
            ),
        ).toThrowError(
            expect.objectContaining({ message: "footer_not_allowed" }),
        );

        expect(() =>
            validateTemplateContent(
                content(
                    "Hello {{ subscriber.name }} {{ address }}",
                    "transactional",
                ),
                "transactional",
            ),
        ).toThrowError(
            expect.objectContaining({
                message: "marketing_variables_not_allowed",
                variables: ["address", "subscriber.name"],
            } satisfies Partial<TemplateValidationError>),
        );
    });
});

describe("required variable discovery", () => {
    it("returns sorted unconditional caller-provided paths", () => {
        const email = content(
            [
                "{{ customer.name }}",
                "{{ otp }}",
                '{{ company | default: "Acme" }}',
                "{% if coupon %}{{ coupon }}{% endif %}",
                "{% for item in order.items %}{{ item.name }}{% endfor %}",
            ].join("\n"),
            "transactional",
        );

        expect(getRequiredTemplateVariables(email, "transactional")).toEqual([
            "customer.name",
            "order.items",
            "otp",
        ]);
    });

    it("excludes platform-provided marketing roots", () => {
        const email = content(
            "Hello {{ subscriber.name }} — campaign {{ campaign.name }}",
            "marketing",
        );

        expect(getRequiredTemplateVariables(email, "marketing")).toEqual([
            "campaign.name",
        ]);
    });
});
