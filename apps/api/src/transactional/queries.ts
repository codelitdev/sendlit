import { and, count, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Email as EmailContent } from "@sendlit/email-editor";
import { db } from "../db/client";
import {
    mailDispatchOutbox,
    outboundMessages,
    transactionalEmails,
} from "../db/schema";
import { getTeam } from "../team/queries";
import { assertMailingAddressConfigured } from "../settings/general/queries";
import { getTemplate } from "../templates/queries";
import { findContactByEmail } from "../contacts/queries";
import {
    MissingTemplateVariablesError,
    renderEmailContent,
} from "../mail/render";
import { getEmailFrom } from "../utils/mail";
import { normalizeEmail } from "../utils/email";
import {
    itemsPerPage,
    type TransactionalEmailStatus,
} from "../config/constants";
import { captureEvent } from "../observability/posthog";
import { serializeDates } from "../utils/serialize";
import { isRecipientSuppressed } from "../delivery-feedback/suppression-queries";
import {
    resolveDeliverySource,
    type DeliverySourceSelection,
} from "../delivery/queries";
import { generateRfcMessageId } from "../utils/rfc-message-id";
import { getActiveFeedbackConnectionForEspConfig } from "../delivery-feedback/feedback-connection-queries";
import { reserveOrganizationQuota } from "../delivery/quota";

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
 * `invalid_headers`, `marketing_variables_not_allowed`,
 * `template_not_found`, `render_failed`,
 * `esp_not_configured`, `esp_not_found`, `recipient_suppressed` — callers
 * map these to the PRD's `400`/`422` responses (see
 * `docs/transactional-emails.md#post-emails--202-accepted` and
 * `docs/bounces-and-complaints.md#8-suppression-model`).
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
    deliverySource,
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
    deliverySource?: DeliverySourceSelection;
}): Promise<TransactionalEmail> {
    // Reject before persisting or queueing so an unconfigured team cannot
    // create delivery work that would later fail in a worker.
    await assertMailingAddressConfigured(teamId);

    if (!!templateId === !!html) {
        throw new Error("invalid_content");
    }
    if (html && variables && Object.keys(variables).length > 0) {
        throw new Error("invalid_content");
    }
    if (
        templateId &&
        ["address", "unsubscribe_link", "subscriber"].some((key) =>
            Object.prototype.hasOwnProperty.call(variables, key),
        )
    ) {
        throw new Error("marketing_variables_not_allowed");
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

    const normalizedTo = normalizeEmail(to);
    // Checked before any DB writes/enqueue — a suppressed recipient must
    // produce no row and no queue job (PRD: "does not enqueue"). Rechecked
    // again immediately before transport in the worker to close the race
    // with a bounce/complaint that arrives after this request is accepted.
    if (await isRecipientSuppressed(teamId, normalizedTo)) {
        throw new Error("recipient_suppressed");
    }

    const team = await getTeam(teamId);
    if (!team) throw new Error("esp_not_configured");

    const pin = await resolveDeliverySource(teamId, deliverySource);

    let renderedHtml: string;
    let resolvedTemplateId: string | null = null;
    if (templateId) {
        const template = await getTemplate(templateId);
        if (!template || template.teamId !== teamId) {
            throw new Error("template_not_found");
        }
        if (template.purpose !== "transactional") {
            captureEvent({
                event: "template_purpose_mismatch",
                source: "transactional.create",
                teamId,
                properties: {
                    template_id: template.templateId,
                    template_purpose: template.purpose,
                    requested_purpose: "transactional",
                },
            });
            throw new Error("template_not_transactional");
        }
        resolvedTemplateId = template.templateId;
        try {
            renderedHtml = await renderEmailContent({
                content: template.content as EmailContent,
                variables,
                requireVariables: true,
            });
        } catch (error) {
            // Rendering happens at request time precisely so template/merge
            // errors surface as a synchronous 400 instead of failing
            // invisibly in the worker (PRD, send pipeline note 1).
            if (error instanceof MissingTemplateVariablesError) {
                captureEvent({
                    event: "transactional_missing_template_variables",
                    source: "transactional.create",
                    teamId,
                    properties: {
                        template_id: template.templateId,
                        missing_variable_count: error.missingVariables.length,
                    },
                });
                throw error;
            }
            throw new Error("render_failed");
        }
    } else {
        // Inline html is sent verbatim — no Liquid pass (see the PRD's
        // Validation notes for why running the merge engine over arbitrary
        // caller-authored HTML would be actively harmful).
        renderedHtml = html!;
    }

    const from = getEmailFrom({
        name: pin.fromName,
        email: pin.fromEmail,
    });

    const contact = await findContactByEmail(teamId, normalizedTo);

    const insertValues = {
        teamId,
        deliverySourceType: pin.type,
        outboxId: pin.espConfigId,
        espGrantId: pin.espGrantId,
        toEmail: normalizedTo,
        fromEmail: from,
        replyTo: replyTo ?? pin.replyTo,
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
    const connection = await getActiveFeedbackConnectionForEspConfig(
        pin.espConfigId,
    );
    const row = await db.transaction(async (tx) => {
        let [created] = idempotencyKey
            ? await tx
                  .insert(transactionalEmails)
                  .values(insertValues)
                  .onConflictDoNothing({
                      target: [
                          transactionalEmails.teamId,
                          transactionalEmails.idempotencyKey,
                      ],
                      where: sql`${transactionalEmails.idempotencyKey} IS NOT NULL`,
                  })
                  .returning()
            : await tx
                  .insert(transactionalEmails)
                  .values(insertValues)
                  .returning();
        if (!created && idempotencyKey) {
            [created] = await tx
                .select()
                .from(transactionalEmails)
                .where(
                    and(
                        eq(transactionalEmails.teamId, teamId),
                        eq(transactionalEmails.idempotencyKey, idempotencyKey),
                    ),
                )
                .limit(1);
            if (!created) throw new Error("idempotency_conflict");
            return created;
        }
        const [outbound] = await tx
            .insert(outboundMessages)
            .values({
                teamId,
                deliverySourceType: pin.type,
                espConfigId: pin.espConfigId,
                espGrantId: pin.espGrantId,
                feedbackConnectionId: connection?.id ?? null,
                sourceType: "transactional",
                submissionKey: `transactional:${created.id}`,
                transactionalEmailId: created.id,
                recipientEmail: to,
                normalizedRecipient: normalizedTo,
                provider: pin.provider,
                rfcMessageId: generateRfcMessageId(),
            })
            .returning();
        if (pin.type === "organization") {
            await reserveOrganizationQuota(tx, {
                outboundMessageId: outbound.id,
                grantId: pin.espGrantId!,
            });
        }
        await tx.insert(mailDispatchOutbox).values({
            outboundMessageId: outbound.id,
            queueName: "mail",
            jobName: "transactional",
        });
        return created;
    });

    captureEvent({
        event: "transactional_email_queued",
        source: "transactional.send",
        teamId,
        properties: { txe_id: row.txeId, delivery_source: pin.type },
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
        .set({
            status: "sent",
            sentAt: new Date(),
            processingStartedAt: null,
            updatedAt: new Date(),
        })
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
        .set({
            status: "failed",
            error,
            processingStartedAt: null,
            updatedAt: new Date(),
        })
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
        .set({
            status: "bounced",
            error,
            processingStartedAt: null,
            updatedAt: new Date(),
        })
        .where(eq(transactionalEmails.id, id))
        .returning();
    return row ?? null;
}

/** A queued job that becomes suppressed between enqueue and transport (a
 * bounce/complaint arrived in the meantime) exits idempotently as
 * `suppressed`, not `failed` — see
 * `docs/bounces-and-complaints.md#8-suppression-model`. Only transitions a
 * still-`queued` row, so a duplicate delivery of the same job can't
 * re-suppress an already-terminal row. */
export async function markTransactionalEmailSuppressed(
    id: string,
): Promise<TransactionalEmail | null> {
    const [row] = await db
        .update(transactionalEmails)
        .set({
            status: "suppressed",
            processingStartedAt: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(transactionalEmails.id, id),
                eq(transactionalEmails.status, "queued"),
            ),
        )
        .returning();
    return row ?? null;
}

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export async function claimTransactionalEmailForSending(id: string) {
    const now = new Date();
    const [row] = await db
        .update(transactionalEmails)
        .set({
            processingStartedAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(transactionalEmails.id, id),
                eq(transactionalEmails.status, "queued"),
                or(
                    isNull(transactionalEmails.processingStartedAt),
                    lt(
                        transactionalEmails.processingStartedAt,
                        new Date(Date.now() - PROCESSING_LEASE_MS),
                    ),
                ),
            ),
        )
        .returning();
    return row ?? null;
}

export async function releaseTransactionalEmailClaim(
    id: string,
): Promise<void> {
    await db
        .update(transactionalEmails)
        .set({
            processingStartedAt: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(transactionalEmails.id, id),
                eq(transactionalEmails.status, "queued"),
            ),
        );
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
