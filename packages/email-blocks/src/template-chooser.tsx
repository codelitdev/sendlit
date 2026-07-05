"use client";

import type { EmailTemplate } from "./types";
import type { Email } from "@sendlit/email-editor";
import { EmailPreview } from "./email-preview";

export interface SystemTemplateSummary {
  templateId: string;
  title: string;
  description: string;
  content: Email;
}

export interface TemplateChooserProps {
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
}: TemplateChooserProps) {
  return (
    <div className={className}>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{systemSectionTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {systemSectionDescription}
          </p>
        </div>
        <TemplateGrid items={systemTemplates} onClick={onSelect} />
      </section>

      <section className="mt-8 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{templatesSectionTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {templatesSectionDescription}
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">{loadingLabel}</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {emptyTemplatesLabel}
          </p>
        ) : (
          <TemplateGrid items={templates} onClick={onSelect} />
        )}
      </section>
    </div>
  );
}

function TemplateGrid({
  items,
  onClick,
}: {
  items: {
    templateId: string;
    title: string;
    description?: string;
    content: Email;
  }[];
  onClick: (item: { templateId: string; title: string }) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.templateId}
          type="button"
          onClick={() => onClick(item)}
          className="flex flex-col items-stretch gap-2 rounded-lg border p-3 text-left transition-shadow hover:shadow-md"
        >
          <span className="text-base font-semibold">{item.title}</span>
          <EmailPreview content={item.content} minHeight="280px" />
          {item.description && (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {item.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
