"use client";

import type { EmailTemplate } from "./types";
import type { Email } from "@sendlit/email-editor";
import type { BlockComponent } from "@sendlit/email-editor";
import type { TemplatePurpose } from "@sendlit/api-contract";
import { EmailPreview } from "./email-preview";
import { Badge } from "./components/ui/badge";

export interface SystemTemplateSummary {
    templateId: string;
    title: string;
    description: string;
    purpose: TemplatePurpose;
    content: Email;
    requiredVariables: string[];
    variableDefinitions?: Array<{
        path: string;
        description: string;
        example: unknown;
    }>;
}

export interface TemplateChooserProps {
    /** Sending context this chooser is being used for. Incompatible items are
     * filtered here even when a caller accidentally passes an unfiltered API
     * response. */
    purpose: TemplatePurpose;
    systemTemplates: SystemTemplateSummary[];
    templates: EmailTemplate[];
    onSelect: (choice: { templateId: string; title: string }) => void;
    loading?: boolean;
    className?: string;
    systemSectionTitle?: string;
    systemSectionDescription?: string;
    templatesSectionTitle?: string;
    templatesSectionDescription?: string;
    loadingLabel?: string;
    emptyTemplatesLabel?: string;
    previewBlocks?: BlockComponent[];
    previewRenderContext?: unknown;
}

export function filterTemplatesForPurpose<
    T extends { purpose: TemplatePurpose },
>(items: T[], purpose: TemplatePurpose): T[] {
    return items.filter((template) => template.purpose === purpose);
}

/**
 * Lets people pick a starting point — one of the built-in system templates
 * (Announcement, New user welcome, Upsell products, Newsletter, Blank) or one
 * of their own saved templates — when creating a template, broadcast,
 * sequence, or adding an email to a sequence. Ported from CourseLit's
 * `NewMailPageClient`/`TemplateGrid` (`apps/web/app/.../mails/new/new-mail-page-client.tsx`),
 * including a real rendered preview of each template (`EmailPreview`), not
 * just its title.
 */
export function TemplateChooser({
    purpose,
    systemTemplates,
    templates,
    onSelect,
    loading,
    className,
    systemSectionTitle = "System",
    systemSectionDescription = "Built-in starters for common email styles and use cases.",
    templatesSectionTitle = "Your templates",
    templatesSectionDescription = "Your saved templates, ready to reuse.",
    loadingLabel = "Loading…",
    emptyTemplatesLabel = "You haven't saved any templates yet.",
    previewBlocks,
    previewRenderContext,
}: TemplateChooserProps) {
    const compatibleSystemTemplates = filterTemplatesForPurpose(
        systemTemplates,
        purpose,
    );
    const compatibleTemplates = filterTemplatesForPurpose(templates, purpose);

    return (
        <div className={className}>
            <section className="space-y-3">
                <div>
                    <h3 className="text-sm font-semibold">
                        {systemSectionTitle}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        {systemSectionDescription}
                    </p>
                </div>
                <TemplateGrid
                    items={compatibleSystemTemplates}
                    onClick={onSelect}
                    previewBlocks={previewBlocks}
                    previewRenderContext={previewRenderContext}
                />
            </section>

            <section className="mt-8 space-y-3">
                <div>
                    <h3 className="text-sm font-semibold">
                        {templatesSectionTitle}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        {templatesSectionDescription}
                    </p>
                </div>
                {loading ? (
                    <p className="text-sm text-muted-foreground">
                        {loadingLabel}
                    </p>
                ) : compatibleTemplates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {emptyTemplatesLabel}
                    </p>
                ) : (
                    <TemplateGrid
                        items={compatibleTemplates}
                        onClick={onSelect}
                        previewBlocks={previewBlocks}
                        previewRenderContext={previewRenderContext}
                    />
                )}
            </section>
        </div>
    );
}

function TemplateGrid({
    items,
    onClick,
    previewBlocks,
    previewRenderContext,
}: {
    items: {
        templateId: string;
        title: string;
        description?: string;
        purpose: TemplatePurpose;
        content: Email;
        requiredVariables: string[];
        variableDefinitions?: Array<{
            path: string;
            description: string;
            example: unknown;
        }>;
    }[];
    onClick: (item: { templateId: string; title: string }) => void;
    previewBlocks?: BlockComponent[];
    previewRenderContext?: unknown;
}) {
    return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
            {items.map((item) => (
                <button
                    key={item.templateId}
                    type="button"
                    onClick={() => onClick(item)}
                    className="flex flex-col items-stretch gap-2 rounded-lg border p-3 text-left transition-shadow hover:shadow-md"
                >
                    <span className="flex items-start justify-between gap-2">
                        <span className="text-base font-semibold">
                            {item.title}
                        </span>
                        <Badge variant="secondary" className="capitalize">
                            {item.purpose}
                        </Badge>
                    </span>
                    <EmailPreview
                        content={item.content}
                        minHeight="280px"
                        previewHeight="280px"
                        blocks={previewBlocks}
                        renderContext={previewRenderContext}
                    />
                    {item.description && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                            {item.description}
                        </span>
                    )}
                    {item.purpose === "transactional" &&
                        item.requiredVariables.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                                Requires{" "}
                                {item.variableDefinitions
                                    ?.map(
                                        ({ path, description }) =>
                                            `${path} — ${description}`,
                                    )
                                    .join("; ") ??
                                    item.requiredVariables.join(", ")}
                            </span>
                        )}
                </button>
            ))}
        </div>
    );
}
