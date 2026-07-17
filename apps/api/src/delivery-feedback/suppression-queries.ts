import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { emailSuppressionActions, emailSuppressions } from "../db/schema";
import {
    itemsPerPage as defaultItemsPerPage,
    ownerReleasableSuppressionReasons,
    suppressionReasonStrength,
    type SuppressionActorType,
    type SuppressionReason,
} from "../config/constants";
import { normalizeEmail } from "../utils/email";
import { currentHashKeyVersion, hashRecipient } from "./suppression-hash";

export type Suppression = typeof emailSuppressions.$inferSelect;

/** Fast existence check for send-path enforcement — no row hydration. Used
 * at both required checkpoints: before enqueue and immediately before
 * transport (see `docs/bounces-and-complaints.md#8-suppression-model`). */
export async function isRecipientSuppressed(
    teamId: string,
    email: string,
): Promise<boolean> {
    const hash = hashRecipient(normalizeEmail(email));
    const [row] = await db
        .select({ id: emailSuppressions.id })
        .from(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.teamId, teamId),
                eq(emailSuppressions.recipientHash, hash),
                eq(emailSuppressions.active, true),
            ),
        )
        .limit(1);
    return Boolean(row);
}

export async function getActiveSuppression(
    teamId: string,
    email: string,
): Promise<Suppression | null> {
    const hash = hashRecipient(normalizeEmail(email));
    const [row] = await db
        .select()
        .from(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.teamId, teamId),
                eq(emailSuppressions.recipientHash, hash),
                eq(emailSuppressions.active, true),
            ),
        )
        .limit(1);
    return row ?? null;
}

/**
 * Adds a new suppression or strengthens an existing one — one row per
 * `(teamId, recipientHash)`, enforced by the schema's unique index.
 * Repeated signals bump `lastSuppressedAt` and keep the strongest `reason`
 * (`suppressionReasonStrength`). A fresh signal always clears a prior
 * release — a new hard bounce re-suppresses immediately and can never be
 * hidden by an old release (PRD acceptance criterion). Always appends an
 * immutable audit action.
 */
export async function addOrStrengthenSuppression({
    teamId,
    recipientEmail,
    reason,
    sourceEventId,
    actorType,
    actorUserId,
    explanation,
}: {
    teamId: string;
    recipientEmail: string;
    reason: SuppressionReason;
    sourceEventId?: string | null;
    actorType: SuppressionActorType;
    actorUserId?: string | null;
    explanation?: string | null;
}): Promise<Suppression> {
    const normalized = normalizeEmail(recipientEmail);
    const hash = hashRecipient(normalized);

    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(emailSuppressions)
            .where(
                and(
                    eq(emailSuppressions.teamId, teamId),
                    eq(emailSuppressions.recipientHash, hash),
                ),
            )
            .limit(1)
            .for("update");

        const now = new Date();

        if (!existing) {
            const [row] = await tx
                .insert(emailSuppressions)
                .values({
                    teamId,
                    recipientEmail,
                    normalizedRecipient: normalized,
                    recipientHash: hash,
                    hashKeyVersion: currentHashKeyVersion(),
                    reason,
                    sourceEventId: sourceEventId ?? null,
                    active: true,
                    firstSuppressedAt: now,
                    lastSuppressedAt: now,
                })
                .returning();
            await tx.insert(emailSuppressionActions).values({
                teamId,
                suppressionId: row.id,
                sourceEventId: sourceEventId ?? null,
                action: "created",
                actorType,
                actorUserId: actorUserId ?? null,
                explanation: explanation ?? null,
            });
            return row;
        }

        const strongerReason =
            suppressionReasonStrength[reason] >
            suppressionReasonStrength[existing.reason as SuppressionReason]
                ? reason
                : (existing.reason as SuppressionReason);
        const reasonChanged = strongerReason !== existing.reason;
        const wasReleased = !existing.active;

        const [row] = await tx
            .update(emailSuppressions)
            .set({
                reason: strongerReason,
                sourceEventId: sourceEventId ?? existing.sourceEventId,
                active: true,
                lastSuppressedAt: now,
                releasedAt: null,
                releasedBy: null,
                releaseReason: null,
                updatedAt: now,
            })
            .where(eq(emailSuppressions.id, existing.id))
            .returning();

        if (reasonChanged || wasReleased) {
            await tx.insert(emailSuppressionActions).values({
                teamId,
                suppressionId: row.id,
                sourceEventId: sourceEventId ?? null,
                action: wasReleased ? "reactivated" : "reason_changed",
                actorType,
                actorUserId: actorUserId ?? null,
                explanation: explanation ?? null,
            });
        }

        return row;
    });
}

/**
 * Releases an active suppression, enforcing the reactivation policy:
 * complaint suppressions can never be released by a `workspace_user` — only
 * `sendlit_operator`. Every permitted release is audited.
 *
 * Throws `Error("suppression_not_found")` or
 * `Error("suppression_not_releasable")`.
 */
export async function releaseSuppression({
    teamId,
    suppressionId,
    actorType,
    actorUserId,
    explanation,
}: {
    teamId: string;
    suppressionId: string;
    actorType: SuppressionActorType;
    actorUserId?: string | null;
    explanation?: string | null;
}): Promise<Suppression> {
    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(emailSuppressions)
            .where(
                and(
                    eq(emailSuppressions.teamId, teamId),
                    eq(emailSuppressions.suppressionId, suppressionId),
                ),
            )
            .limit(1)
            .for("update");
        if (!existing || !existing.active) {
            throw new Error("suppression_not_found");
        }

        const reason = existing.reason as SuppressionReason;
        if (
            actorType === "workspace_user" &&
            !ownerReleasableSuppressionReasons.includes(reason)
        ) {
            throw new Error("suppression_not_releasable");
        }

        const now = new Date();
        const [row] = await tx
            .update(emailSuppressions)
            .set({
                active: false,
                releasedAt: now,
                releasedBy: actorUserId ?? null,
                releaseReason: explanation ?? null,
                updatedAt: now,
            })
            .where(eq(emailSuppressions.id, existing.id))
            .returning();

        await tx.insert(emailSuppressionActions).values({
            teamId,
            suppressionId: row.id,
            action: "released",
            actorType,
            actorUserId: actorUserId ?? null,
            explanation: explanation ?? null,
        });

        return row;
    });
}

export async function getSuppressionBySuppressionId(
    teamId: string,
    suppressionId: string,
): Promise<Suppression | null> {
    const [row] = await db
        .select()
        .from(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.teamId, teamId),
                eq(emailSuppressions.suppressionId, suppressionId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function listSuppressions({
    teamId,
    active,
    reason,
    offset = 1,
    rowsPerPage = defaultItemsPerPage,
}: {
    teamId: string;
    active?: boolean;
    reason?: SuppressionReason;
    offset?: number;
    rowsPerPage?: number;
}): Promise<Suppression[]> {
    const conditions = [eq(emailSuppressions.teamId, teamId)];
    if (active !== undefined)
        conditions.push(eq(emailSuppressions.active, active));
    if (reason) conditions.push(eq(emailSuppressions.reason, reason));

    return db
        .select()
        .from(emailSuppressions)
        .where(and(...conditions))
        .orderBy(desc(emailSuppressions.lastSuppressedAt))
        .limit(rowsPerPage)
        .offset((Math.max(offset, 1) - 1) * rowsPerPage);
}

export async function countSuppressions({
    teamId,
    active,
    reason,
}: {
    teamId: string;
    active?: boolean;
    reason?: SuppressionReason;
}): Promise<number> {
    const conditions = [eq(emailSuppressions.teamId, teamId)];
    if (active !== undefined)
        conditions.push(eq(emailSuppressions.active, active));
    if (reason) conditions.push(eq(emailSuppressions.reason, reason));

    const [row] = await db
        .select({ value: count() })
        .from(emailSuppressions)
        .where(and(...conditions));
    return row?.value ?? 0;
}
