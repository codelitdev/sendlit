import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { emailTemplates } from "../db/schema";
import type { Email as EmailContent } from "@sendlit/email-editor";
import { getSystemTemplate } from "./system-templates";
import { captureEvent } from "../observability/posthog";

export type EmailTemplate = typeof emailTemplates.$inferSelect;

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
): Promise<{ title: string; content: EmailContent } | null> {
    const system = getSystemTemplate(templateId);
    if (system) return { title: system.title, content: system.content };

    const template = await getTemplate(templateId);
    if (!template || template.teamId !== teamId) return null;
    return { title: template.title, content: template.content as EmailContent };
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
}: {
    teamId: string;
    title: string;
    content: EmailContent;
}): Promise<EmailTemplate> {
    const uniqueTitle = await getUniqueTemplateTitle(teamId, title);
    const [template] = await db
        .insert(emailTemplates)
        .values({
            teamId,
            title: uniqueTitle,
            content,
        })
        .returning();
    captureEvent({
        event: "template_created",
        source: "templates.create",
        teamId,
        properties: { template_id: template.templateId },
    });
    return template;
}

export async function getTemplate(
    templateId: string,
): Promise<EmailTemplate | null> {
    const [row] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.templateId, templateId))
        .limit(1);
    return row ?? null;
}

export async function listTemplates(teamId: string): Promise<EmailTemplate[]> {
    return db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.teamId, teamId));
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

    const patch: Partial<EmailTemplate> = { updatedAt: new Date() };
    if (title) patch.title = title;
    if (content) patch.content = content as any;

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
    return row ?? null;
}

export async function deleteTemplate(
    teamId: string,
    templateId: string,
): Promise<void> {
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
