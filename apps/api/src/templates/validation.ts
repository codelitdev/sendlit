import type { TemplatePurpose } from "@sendlit/api-contract";
import type { Email, EmailBlock } from "@sendlit/email-editor";
import { discoverRequiredTemplateVariables } from "../mail/render";

const FOOTER_SETTINGS = new Set([
    "alignment",
    "fontFamily",
    "fontSize",
    "foregroundColor",
    "backgroundColor",
    "paddingTop",
    "paddingBottom",
    "paddingX",
]);

const PLATFORM_VARIABLE_ROOTS = new Set([
    "subscriber",
    "address",
    "unsubscribe_link",
]);

export class TemplateValidationError extends Error {
    readonly variables?: string[];

    constructor(code: string, variables?: string[]) {
        super(code);
        this.name = "TemplateValidationError";
        this.variables = variables;
    }
}

function blocks(content: Email): EmailBlock[] {
    return Array.isArray(content.content) ? content.content : [];
}

function liquidTokens(source: string): string[] {
    return Array.from(
        source.matchAll(/{{-?\s*([\s\S]*?)\s*-?}}|{%-?\s*([\s\S]*?)\s*-?%}/g),
        (match) => match[1] ?? match[2] ?? "",
    );
}

export function findReservedMarketingVariables(content: Email): string[] {
    const found = new Set<string>();
    for (const token of liquidTokens(JSON.stringify(content))) {
        for (const match of token.matchAll(
            /\b(address|unsubscribe_link|subscriber(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\b/g,
        )) {
            found.add(match[1]);
        }
    }
    return [...found].sort();
}

function validateFooterSettings(block: EmailBlock): void {
    if (
        !block.settings ||
        typeof block.settings !== "object" ||
        Array.isArray(block.settings)
    ) {
        throw new TemplateValidationError("invalid_footer");
    }
    const invalid = Object.entries(block.settings).flatMap(([key, value]) => {
        if (!FOOTER_SETTINGS.has(key)) return [key];
        if (typeof value !== "string") return [key];
        if (
            key === "alignment" &&
            !["left", "center", "right"].includes(value)
        ) {
            return [key];
        }
        if (
            ["fontSize", "paddingTop", "paddingBottom", "paddingX"].includes(
                key,
            ) &&
            !/^\d+(?:\.\d+)?px$/.test(value)
        ) {
            return [key];
        }
        if (
            key === "foregroundColor" &&
            !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
        ) {
            return [key];
        }
        if (
            key === "backgroundColor" &&
            value !== "transparent" &&
            !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
        ) {
            return [key];
        }
        if (key === "fontFamily" && value.trim().length === 0) return [key];
        return [];
    });
    if (invalid.length > 0) {
        throw new TemplateValidationError("invalid_footer", invalid.sort());
    }
}

export function validateTemplateContent(
    content: Email,
    purpose: TemplatePurpose,
): void {
    const contentBlocks = blocks(content);
    const footerIndexes = contentBlocks.flatMap((block, index) =>
        block.blockType === "footer" ? [index] : [],
    );

    if (purpose === "transactional") {
        if (footerIndexes.length > 0) {
            throw new TemplateValidationError("footer_not_allowed");
        }
        const reservedVariables = findReservedMarketingVariables(content);
        if (reservedVariables.length > 0) {
            throw new TemplateValidationError(
                "marketing_variables_not_allowed",
                reservedVariables,
            );
        }
        return;
    }

    if (
        footerIndexes.length !== 1 ||
        footerIndexes[0] !== contentBlocks.length - 1
    ) {
        throw new TemplateValidationError("footer_required");
    }
    validateFooterSettings(contentBlocks[footerIndexes[0]]);

    const ordinaryContent: Email = {
        ...content,
        content: contentBlocks.slice(0, -1),
    };
    const reservedInOrdinaryBlocks = findReservedMarketingVariables(
        ordinaryContent,
    ).filter((path) => path === "address" || path === "unsubscribe_link");
    if (reservedInOrdinaryBlocks.length > 0) {
        throw new TemplateValidationError(
            "footer_variables_reserved",
            reservedInOrdinaryBlocks,
        );
    }
}

export function getRequiredTemplateVariables(
    content: Email,
    purpose: TemplatePurpose,
): string[] {
    validateTemplateContent(content, purpose);
    const discovered = discoverRequiredTemplateVariables(
        JSON.stringify(content),
    );
    return discovered.filter((path) => {
        if (purpose === "transactional") return true;
        return !PLATFORM_VARIABLE_ROOTS.has(path.split(".")[0]);
    });
}
