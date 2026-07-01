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
}: TemplateChooserProps) {
  return (
    <div className={className}>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">System</h3>
          <p className="text-xs text-muted-foreground">
            Built-in starters for common email styles and use cases.
          </p>
        </div>
        <TemplateGrid items={systemTemplates} onClick={onSelect} />
      </section>

      <section className="mt-8 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Your templates</h3>
          <p className="text-xs text-muted-foreground">
            Your saved templates, ready to reuse.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t saved any templates yet.
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
