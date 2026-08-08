import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { emailTemplates } from "../db/schema";
import type { Email as EmailContent } from "@sendlit/email-editor";
import { getSystemTemplate } from "./system-templates";
import { captureEvent } from "../observability/posthog";
import { syncEmailContentMediaReferences } from "../media/email-content";
import { deleteMediaReferencesForResource } from "../media/queries";
import type { TemplatePurpose } from "@sendlit/api-contract";
import {
    TemplateValidationError,
    getRequiredTemplateVariables,
    validateTemplateInputContent,
} from "./validation";

export type StoredEmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailTemplate = StoredEmailTemplate & {
    requiredVariables: string[];
    /** Present only in list responses for a retired template row. */
    validationError?: string;
};

function withRequiredVariables(template: StoredEmailTemplate): EmailTemplate {
    return {
        ...template,
        requiredVariables: getRequiredTemplateVariables(
            template.content as EmailContent,
            template.purpose,
        ),
    };
}

function withListRequiredVariables(
    template: StoredEmailTemplate,
): EmailTemplate {
    try {
        return withRequiredVariables(template);
    } catch (error) {
        if (!(error instanceof TemplateValidationError)) throw error;
        return {
            ...template,
            requiredVariables: [],
            validationError: error.message,
        };
    }
}

/**
 * Resolves a starting point for a new broadcast/sequence/sequence-email:
 * either one of the built-in system templates (`templates/system-templates.ts`,
 * ported from CourseLit's system-email chooser) or one of the team's own
 * saved templates. Returns `null` if `templateId` matches neither — callers
 * should treat that the same as "template not found".
 */
export async function resolveStartingTemplate(
    teamId: string,
    templateId: string,
    purpose: TemplatePurpose,
): Promise<{
    title: string;
    content: EmailContent;
    purpose: TemplatePurpose;
} | null> {
    const system = getSystemTemplate(templateId);
    if (system) {
        if (system.purpose !== purpose) {
            captureEvent({
                event: "template_purpose_mismatch",
                source: "templates.resolve",
                teamId,
                properties: {
                    template_id: templateId,
                    template_purpose: system.purpose,
                    requested_purpose: purpose,
                },
            });
            throw new Error(`template_not_${purpose}`);
        }
        return {
            title: system.title,
            content: system.content,
            purpose: system.purpose,
        };
    }

    const template = await getTemplate(templateId);
    if (!template || template.teamId !== teamId) return null;
    if (template.purpose !== purpose) {
        captureEvent({
            event: "template_purpose_mismatch",
            source: "templates.resolve",
            teamId,
            properties: {
                template_id: templateId,
                template_purpose: template.purpose,
                requested_purpose: purpose,
            },
        });
        throw new Error(`template_not_${purpose}`);
    }
    return {
        title: template.title,
        content: template.content as EmailContent,
        purpose: template.purpose,
    };
}

export async function getUniqueTemplateTitle(
    teamId: string,
    title: string,
): Promise<string> {
    const existing = await db
        .select({ title: emailTemplates.title })
        .from(emailTemplates)
        .where(eq(emailTemplates.teamId, teamId));

    const titles = new Set(existing.map((row) => row.title));
    if (!titles.has(title)) return title;

    let suffix = 1;
    while (titles.has(`${title} (${suffix})`)) {
        suffix += 1;
    }
    return `${title} (${suffix})`;
}

export async function createTemplate({
    teamId,
    title,
    content,
    purpose = "marketing",
}: {
    teamId: string;
    title: string;
    content: EmailContent;
    purpose?: TemplatePurpose;
}): Promise<EmailTemplate> {
    validateTemplateInputContent(content, purpose);
    const uniqueTitle = await getUniqueTemplateTitle(teamId, title);

    const [template] = await db
        .insert(emailTemplates)
        .values({
            teamId,
            title: uniqueTitle,
            content,
            purpose,
        })
        .returning();

    const reconciledContent = await syncEmailContentMediaReferences({
        teamId,
        content,
        resource: {
            resourceType: "TEMPLATE",
            resourceInternalId: template.id,
            resourcePublicId: template.templateId,
        },
    });
    if (reconciledContent) {
        const [updated] = await db
            .update(emailTemplates)
            .set({ content: reconciledContent, updatedAt: new Date() })
            .where(eq(emailTemplates.id, template.id))
            .returning();
        Object.assign(template, updated);
    }
    captureEvent({
        event: "template_created",
        source: "templates.create",
        teamId,
        properties: {
            template_id: template.templateId,
            template_purpose: template.purpose,
        },
    });
    return withRequiredVariables(template);
}

export async function getTemplate(
    templateId: string,
): Promise<EmailTemplate | null> {
    const [row] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.templateId, templateId))
        .limit(1);
    return row ? withRequiredVariables(row) : null;
}

export async function listTemplates(
    teamId: string,
    purpose?: TemplatePurpose,
): Promise<EmailTemplate[]> {
    const rows = await db
        .select()
        .from(emailTemplates)
        .where(
            purpose
                ? and(
                      eq(emailTemplates.teamId, teamId),
                      eq(emailTemplates.purpose, purpose),
                  )
                : eq(emailTemplates.teamId, teamId),
        );
    // Early SendLit deployments intentionally have no automatic legacy-footer
    // migration. Keep retired rows visible for deletion/recreation without
    // letting one bad historical document make the template hub a 500.
    return rows.map(withListRequiredVariables);
}

export async function updateTemplate({
    teamId,
    templateId,
    title,
    content,
}: {
    teamId: string;
    templateId: string;
    title?: string;
    content?: EmailContent;
}): Promise<EmailTemplate | null> {
    const existing = await getTemplate(templateId);
    if (!existing || existing.teamId !== teamId) {
        return null;
    }
    if (content) validateTemplateInputContent(content, existing.purpose);

    if (title) {
        const [clash] = await db
            .select({ templateId: emailTemplates.templateId })
            .from(emailTemplates)
            .where(
                and(
                    eq(emailTemplates.teamId, teamId),
                    eq(emailTemplates.title, title),
                    ne(emailTemplates.templateId, templateId),
                ),
            )
            .limit(1);
        if (clash) {
            throw new Error("duplicate_title");
        }
    }

    const patch: Partial<StoredEmailTemplate> = { updatedAt: new Date() };
    if (title) patch.title = title;
    if (content) {
        const reconciledContent = await syncEmailContentMediaReferences({
            teamId,
            content,
            resource: {
                resourceType: "TEMPLATE",
                resourceInternalId: existing!.id,
                resourcePublicId: existing!.templateId,
            },
        });
        patch.content = (reconciledContent || content) as any;
    }

    const [row] = await db
        .update(emailTemplates)
        .set(patch)
        .where(
            and(
                eq(emailTemplates.teamId, teamId),
                eq(emailTemplates.templateId, templateId),
            ),
        )
        .returning();
    if (row) {
        captureEvent({
            event: "template_updated",
            source: "templates.update",
            teamId,
            properties: { template_id: row.templateId },
        });
    }
    return row ? withRequiredVariables(row) : null;
}

export async function duplicateTemplate({
    teamId,
    templateId,
    title,
}: {
    teamId: string;
    templateId: string;
    title?: string;
}): Promise<EmailTemplate | null> {
    const system = getSystemTemplate(templateId);
    let source: {
        title: string;
        content: EmailContent;
        purpose: TemplatePurpose;
    };
    if (system) {
        source = {
            title: system.title,
            content: structuredClone(system.content),
            purpose: system.purpose,
        };
    } else {
        const teamTemplate = await getTemplate(templateId);
        if (!teamTemplate || teamTemplate.teamId !== teamId) return null;
        source = {
            title: teamTemplate.title,
            content: structuredClone(teamTemplate.content) as EmailContent,
            purpose: teamTemplate.purpose,
        };
    }

    const content = structuredClone(source.content);
    validateTemplateInputContent(content, source.purpose);
    const duplicate = await createTemplate({
        teamId,
        title: title ?? `${source.title} (Copy)`,
        purpose: source.purpose,
        content,
    });
    captureEvent({
        event: "template_duplicated",
        source: "templates.duplicate",
        teamId,
        properties: {
            source_template_id: templateId,
            destination_template_id: duplicate.templateId,
            source_purpose: source.purpose,
            destination_purpose: source.purpose,
        },
    });
    return duplicate;
}

export async function deleteTemplate(
    teamId: string,
    templateId: string,
): Promise<void> {
    // A retired template is deliberately deletable even though `getTemplate`
    // rejects its invalid content.
    const [template] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.templateId, templateId))
        .limit(1);
    if (template && template.teamId === teamId) {
        await deleteMediaReferencesForResource({
            teamId,
            resourceType: "TEMPLATE",
            resourceInternalId: template.id,
        });
    }

    await db
        .delete(emailTemplates)
        .where(
            and(
                eq(emailTemplates.teamId, teamId),
                eq(emailTemplates.templateId, templateId),
            ),
        );
    captureEvent({
        event: "template_deleted",
        source: "templates.delete",
        teamId,
        properties: { template_id: templateId },
    });
}
