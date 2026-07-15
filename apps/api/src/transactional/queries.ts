import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Email as EmailContent } from "@sendlit/email-editor";
import { db } from "../db/client";
import { transactionalEmails } from "../db/schema";
import { getTeam } from "../team/queries";
import { getAccount, hasMailQuotaRemaining } from "../account/queries";
import { getEspConfig } from "../settings/esp/queries";
import { getTemplate } from "../templates/queries";
import { findContactByEmail } from "../contacts/queries";
import { renderEmailContent } from "../mail/render";
import { addTransactionalMailJob } from "../mail/queue";
import { getEmailFrom } from "../utils/mail";
import {
    itemsPerPage,
    type TransactionalEmailStatus,
} from "../config/constants";
import { captureEvent } from "../observability/posthog";
import { serializeDates } from "../utils/serialize";

export type TransactionalEmail = typeof transactionalEmails.$inferSelect;
export type { TransactionalEmailStatus };

/**
 * Public row shape shared by the REST routes (`transactional/routes.ts`) and
 * the MCP tools (`mcp/tools/transactional.ts`) — both need the exact same
 * field renames (`toEmail`/`fromEmail` → `to`/`from`) and date
 * serialization, so it lives here once instead of being duplicated per
 * transport. `list` omits `html` to keep pages light; `get`/`send` include it.
 */
export function toPublicTransactionalEmail(
    row: TransactionalEmail,
    { includeHtml }: { includeHtml: boolean },
) {
    const base = {
        txeId: row.txeId,
        to: row.toEmail,
        from: row.fromEmail,
        replyTo: row.replyTo,
        subject: row.subject,
        templateId: row.templateId,
        variables: row.variables,
        status: row.status,
        error: row.error,
        trackOpens: row.trackOpens,
        trackClicks: row.trackClicks,
        openCount: row.openCount,
        clickCount: row.clickCount,
        sentAt: row.sentAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
    return serializeDates(includeHtml ? { ...base, html: row.html } : base);
}

export async function findTransactionalEmailByIdempotencyKey(
    teamId: string,
    idempotencyKey: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .select()
        .from(transactionalEmails)
        .where(
            and(
                eq(transactionalEmails.teamId, teamId),
                eq(transactionalEmails.idempotencyKey, idempotencyKey),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getTransactionalEmailByTxeId(
    txeId: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .select()
        .from(transactionalEmails)
        .where(eq(transactionalEmails.txeId, txeId))
        .limit(1);
    return row ?? null;
}

/** Internal-id lookup — used by the worker, whose job payload only carries
 * the row's internal `id` (see `mail/queue.ts#addTransactionalMailJob`). */
export async function getTransactionalEmailById(
    id: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .select()
        .from(transactionalEmails)
        .where(eq(transactionalEmails.id, id))
        .limit(1);
    return row ?? null;
}

function listTransactionalEmailsConditions({
    teamId,
    status,
    createdAfter,
    createdBefore,
}: {
    teamId: string;
    status?: TransactionalEmailStatus;
    createdAfter?: number;
    createdBefore?: number;
}) {
    const conditions = [eq(transactionalEmails.teamId, teamId)];
    if (status) conditions.push(eq(transactionalEmails.status, status));
    if (createdAfter !== undefined) {
        conditions.push(
            gte(transactionalEmails.createdAt, new Date(createdAfter)),
        );
    }
    if (createdBefore !== undefined) {
        conditions.push(
            lt(transactionalEmails.createdAt, new Date(createdBefore)),
        );
    }
    return and(...conditions);
}

export async function listTransactionalEmails({
    teamId,
    status,
    createdAfter,
    createdBefore,
    offset = 1,
    rowsPerPage = itemsPerPage,
}: {
    teamId: string;
    status?: TransactionalEmailStatus;
    createdAfter?: number;
    createdBefore?: number;
    offset?: number;
    rowsPerPage?: number;
}): Promise<TransactionalEmail[]> {
    return db
        .select()
        .from(transactionalEmails)
        .where(
            listTransactionalEmailsConditions({
                teamId,
                status,
                createdAfter,
                createdBefore,
            }),
        )
        .orderBy(desc(transactionalEmails.createdAt))
        .limit(rowsPerPage)
        .offset((Math.max(offset, 1) - 1) * rowsPerPage);
}

export async function countTransactionalEmails(
    teamId: string,
    opts: {
        status?: TransactionalEmailStatus;
        createdAfter?: number;
        createdBefore?: number;
    } = {},
): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(transactionalEmails)
        .where(listTransactionalEmailsConditions({ teamId, ...opts }));
    return row?.value ?? 0;
}

/**
 * Validates, renders, persists (idempotently) and enqueues a single
 * transactional send. Framework-agnostic — called from both the REST route
 * and the MCP tool, so every validation rule the ts-rest contract's zod
 * schema enforces for REST callers is re-checked here too (an MCP caller
 * never goes through that schema).
 *
 * Throws a plain `Error` whose `message` is one of: `invalid_content`,
 * `invalid_headers`, `template_not_found`, `render_failed`,
 * `esp_not_configured`, `quota_exceeded` — callers map these to the PRD's
 * `400`/`422`/`429` responses (see
 * `docs/transactional-emails.md#post-emails--202-accepted`).
 */
export async function createTransactionalEmail({
    teamId,
    to,
    subject,
    templateId,
    html,
    variables = {},
    replyTo,
    headers,
    idempotencyKey,
    trackOpens = false,
    trackClicks = false,
}: {
    teamId: string;
    to: string;
    subject: string;
    templateId?: string;
    html?: string;
    variables?: Record<string, unknown>;
    replyTo?: string;
    headers?: Record<string, string>;
    idempotencyKey?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
}): Promise<TransactionalEmail> {
    if (!!templateId === !!html) {
        throw new Error("invalid_content");
    }
    if (html && variables && Object.keys(variables).length > 0) {
        throw new Error("invalid_content");
    }
    // The ts-rest contract (`emailHeadersSchema`) already rejects these for
    // REST callers; re-checked here because MCP callers never pass through
    // that schema. CR/LF would allow SMTP header injection; the reserved
    // names are owned by the pipeline (sender identity is resolved
    // server-side — see the PRD's validation notes).
    assertValidHeaders(headers);

    if (idempotencyKey) {
        const existing = await findTransactionalEmailByIdempotencyKey(
            teamId,
            idempotencyKey,
        );
        if (existing) return existing;
    }

    const team = await getTeam(teamId);
    if (!team) throw new Error("esp_not_configured");

    const espConfig = await getEspConfig(teamId);
    if (!espConfig) throw new Error("esp_not_configured");

    const ownerAccount = await getAccount(team.ownerAccountId);
    const hasQuota = await hasMailQuotaRemaining(team.ownerAccountId);
    if (!hasQuota) throw new Error("quota_exceeded");

    let renderedHtml: string;
    let resolvedTemplateId: string | null = null;
    if (templateId) {
        const template = await getTemplate(templateId);
        if (!template || template.teamId !== teamId) {
            throw new Error("template_not_found");
        }
        resolvedTemplateId = template.templateId;
        try {
            renderedHtml = await renderEmailContent({
                content: template.content as EmailContent,
                variables,
            });
        } catch {
            // Rendering happens at request time precisely so template/merge
            // errors surface as a synchronous 400 instead of failing
            // invisibly in the worker (PRD, send pipeline note 1).
            throw new Error("render_failed");
        }
    } else {
        // Inline html is sent verbatim — no Liquid pass (see the PRD's
        // Validation notes for why running the merge engine over arbitrary
        // caller-authored HTML would be actively harmful).
        renderedHtml = html!;
    }

    const from = getEmailFrom({
        name: espConfig.fromName || team.name,
        email:
            espConfig.fromEmail ||
            ownerAccount?.email ||
            process.env.EMAIL_FROM ||
            "",
    });

    const normalizedTo = to.toLowerCase().trim();
    const contact = await findContactByEmail(teamId, normalizedTo);

    const insertValues = {
        teamId,
        toEmail: normalizedTo,
        fromEmail: from,
        replyTo: replyTo ?? null,
        subject,
        templateId: resolvedTemplateId,
        html: renderedHtml,
        variables,
        headers: headers ?? null,
        contactId: contact?.id ?? null,
        idempotencyKey: idempotencyKey ?? null,
        trackOpens,
        trackClicks,
    };

    // Idempotency replay must be race-safe against concurrent duplicate
    // requests: `ON CONFLICT ... DO NOTHING` against the partial unique
    // index, re-selecting the winner's row on conflict, rather than a
    // check-then-insert (see docs/transactional-emails.md#post-emails).
    let row: TransactionalEmail | undefined;
    if (idempotencyKey) {
        [row] = await db
            .insert(transactionalEmails)
            .values(insertValues)
            .onConflictDoNothing({
                target: [
                    transactionalEmails.teamId,
                    transactionalEmails.idempotencyKey,
                ],
                where: sql`${transactionalEmails.idempotencyKey} IS NOT NULL`,
            })
            .returning();
        if (!row) {
            const existing = await findTransactionalEmailByIdempotencyKey(
                teamId,
                idempotencyKey,
            );
            if (existing) return existing;
        }
    }
    if (!row) {
        [row] = await db
            .insert(transactionalEmails)
            .values(insertValues)
            .returning();
    }

    await addTransactionalMailJob({ transactionalEmailId: row.id });

    captureEvent({
        event: "transactional_email_queued",
        source: "transactional.send",
        teamId,
        properties: { txe_id: row.txeId },
    });

    return row;
}

const RESERVED_HEADERS = new Set(["from", "to", "subject", "content-type"]);

function assertValidHeaders(headers?: Record<string, string>): void {
    if (!headers) return;
    for (const [name, value] of Object.entries(headers)) {
        if (
            /[\r\n]/.test(name) ||
            /[\r\n]/.test(value) ||
            RESERVED_HEADERS.has(name.toLowerCase())
        ) {
            throw new Error("invalid_headers");
        }
    }
}

export async function markTransactionalEmailSent(
    id: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .update(transactionalEmails)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(transactionalEmails.id, id))
        .returning();
    return row ?? null;
}

export async function markTransactionalEmailFailed(
    id: string,
    error: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .update(transactionalEmails)
        .set({ status: "failed", error, updatedAt: new Date() })
        .where(eq(transactionalEmails.id, id))
        .returning();
    return row ?? null;
}

export async function markTransactionalEmailBounced(
    id: string,
    error: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .update(transactionalEmails)
        .set({ status: "bounced", error, updatedAt: new Date() })
        .where(eq(transactionalEmails.id, id))
        .returning();
    return row ?? null;
}

export async function incrementTransactionalEmailOpenCount(
    txeId: string,
): Promise<void> {
    await db
        .update(transactionalEmails)
        .set({
            openCount: sql`${transactionalEmails.openCount} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(transactionalEmails.txeId, txeId));
}

export async function incrementTransactionalEmailClickCount(
    txeId: string,
): Promise<void> {
    await db
        .update(transactionalEmails)
        .set({
            clickCount: sql`${transactionalEmails.clickCount} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(transactionalEmails.txeId, txeId));
}
