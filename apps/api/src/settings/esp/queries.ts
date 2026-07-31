import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db/client";
import {
    espConfigs,
    espConfigTeamGrants,
    espFeedbackConnections,
    mailDispatchOutbox,
    outboundMessages,
    sequences,
    teamDeliverySettings,
    transactionalEmails,
} from "../../db/schema";
import { decryptSecret, encryptSecret } from "../../utils/secret-crypto";
import { cancelQueuedWorkForGrantInTransaction } from "../../delivery/queries";
import { releaseReservedQuotaForGrantInTransaction } from "../../delivery/quota";

export type EspConfig = typeof espConfigs.$inferSelect;
export type EspOwnerScope = "organization" | "team";
export type EspProvider =
    "smtp" | "sendgrid" | "mailgun" | "postmark" | "ses" | "resend";
export type EspStatus =
    "draft" | "active" | "suspended" | "draining" | "retired";

export interface EspConnectionInput {
    provider: EspProvider;
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    /** `undefined` keeps the existing secret; an empty string clears it. */
    password?: string;
    fromName?: string;
    fromEmail?: string;
}

export interface CreateEspConfigInput extends EspConnectionInput {
    name: string;
}

export type UpdateEspConfigInput = Partial<CreateEspConfigInput>;
export type EspConfigInput = EspConnectionInput & { name?: string };

function encryptedSecretForInput(
    password: string | undefined,
    existing?: EspConfig | null,
): string | null {
    if (password === undefined) return existing?.encryptedSecret ?? null;
    if (password === "") return null;
    return encryptSecret(JSON.stringify({ password }));
}

export async function listEspConfigs(teamId: string): Promise<EspConfig[]> {
    return db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "team"),
                eq(espConfigs.teamId, teamId),
            ),
        )
        .orderBy(asc(espConfigs.createdAt));
}

export async function listOrganizationEspConfigs(
    organizationId: string,
): Promise<EspConfig[]> {
    return db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "organization"),
                eq(espConfigs.organizationId, organizationId),
            ),
        )
        .orderBy(asc(espConfigs.createdAt));
}

/** Returns the explicitly selected default team-owned ESP. */
export async function getEspConfig(teamId: string): Promise<EspConfig | null> {
    const [row] = await db
        .select({ esp: espConfigs })
        .from(teamDeliverySettings)
        .innerJoin(
            espConfigs,
            eq(espConfigs.id, teamDeliverySettings.defaultTeamEspConfigId),
        )
        .where(
            and(
                eq(teamDeliverySettings.teamId, teamId),
                eq(teamDeliverySettings.defaultSource, "team"),
                eq(espConfigs.ownerScope, "team"),
                eq(espConfigs.teamId, teamId),
            ),
        )
        .limit(1);
    return row?.esp ?? null;
}

export async function getEspConfigByEspId(
    teamId: string,
    espId: string,
): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "team"),
                eq(espConfigs.teamId, teamId),
                eq(espConfigs.espId, espId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getOrganizationEspConfigByEspId(
    organizationId: string,
    espId: string,
): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            and(
                eq(espConfigs.ownerScope, "organization"),
                eq(espConfigs.organizationId, organizationId),
                eq(espConfigs.espId, espId),
            ),
        )
        .limit(1);
    return row ?? null;
}

/** Internal lookup used only after a delivery route has already been pinned. */
export async function getEspConfigById(
    id: string,
    teamId?: string,
): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            teamId
                ? and(
                      eq(espConfigs.id, id),
                      eq(espConfigs.ownerScope, "team"),
                      eq(espConfigs.teamId, teamId),
                  )
                : eq(espConfigs.id, id),
        )
        .limit(1);
    return row ?? null;
}

export async function resolveEspConfig(
    teamId: string,
    espId?: string | null,
): Promise<EspConfig | null> {
    return espId ? getEspConfigByEspId(teamId, espId) : getEspConfig(teamId);
}

async function createOwnedEspConfig(
    owner: {
        ownerScope: EspOwnerScope;
        organizationId?: string;
        teamId?: string;
    },
    input: CreateEspConfigInput,
): Promise<EspConfig> {
    const [row] = await db
        .insert(espConfigs)
        .values({
            ...owner,
            name: input.name,
            provider: input.provider,
            host: input.host,
            port: input.port,
            secure: input.secure,
            username: input.username || null,
            encryptedSecret: encryptedSecretForInput(input.password),
            fromName: input.fromName || null,
            fromEmail: input.fromEmail || null,
        })
        .returning();
    return row;
}

export function createEspConfig(
    teamId: string,
    input: CreateEspConfigInput,
): Promise<EspConfig> {
    return createOwnedEspConfig({ ownerScope: "team", teamId }, input);
}

export function createOrganizationEspConfig(
    organizationId: string,
    input: CreateEspConfigInput,
): Promise<EspConfig> {
    return createOwnedEspConfig(
        { ownerScope: "organization", organizationId },
        input,
    );
}

function transportChanged(
    existing: EspConfig,
    input: UpdateEspConfigInput,
): boolean {
    return (
        (input.provider !== undefined &&
            input.provider !== existing.provider) ||
        (input.host !== undefined && input.host !== existing.host) ||
        (input.port !== undefined && input.port !== existing.port) ||
        (input.secure !== undefined && input.secure !== existing.secure) ||
        (input.username !== undefined &&
            (input.username || null) !== existing.username) ||
        input.password !== undefined ||
        (input.fromEmail !== undefined &&
            (input.fromEmail || null) !== existing.fromEmail)
    );
}

async function updateOwnedEspConfig(
    owner: {
        ownerScope: EspOwnerScope;
        organizationId?: string;
        teamId?: string;
    },
    espId: string,
    input: UpdateEspConfigInput,
): Promise<EspConfig | null> {
    return db.transaction(async (tx) => {
        const ownerPredicate =
            owner.ownerScope === "organization"
                ? eq(espConfigs.organizationId, owner.organizationId!)
                : eq(espConfigs.teamId, owner.teamId!);
        const [existing] = await tx
            .select()
            .from(espConfigs)
            .where(
                and(
                    eq(espConfigs.ownerScope, owner.ownerScope),
                    ownerPredicate,
                    eq(espConfigs.espId, espId),
                ),
            )
            .limit(1)
            .for("update");
        if (!existing) return null;
        if (existing.status === "retired") {
            throw new Error("invalid_lifecycle_transition");
        }

        const invalidatesTest = transportChanged(existing, input);
        const values: Partial<typeof espConfigs.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.name !== undefined) values.name = input.name;
        if (input.provider !== undefined) values.provider = input.provider;
        if (input.host !== undefined) values.host = input.host;
        if (input.port !== undefined) values.port = input.port;
        if (input.secure !== undefined) values.secure = input.secure;
        if (input.username !== undefined)
            values.username = input.username || null;
        if (input.password !== undefined)
            values.encryptedSecret = encryptedSecretForInput(
                input.password,
                existing,
            );
        if (input.fromName !== undefined)
            values.fromName = input.fromName || null;
        if (input.fromEmail !== undefined)
            values.fromEmail = input.fromEmail || null;
        if (invalidatesTest) {
            values.secretVersion = existing.secretVersion + 1;
            values.lastTestedAt = null;
            values.lastTestStatus = null;
            values.lastTestError = null;
            if (existing.status !== "draft") values.status = "draft";
        }

        const [updated] = await tx
            .update(espConfigs)
            .set(values)
            .where(eq(espConfigs.id, existing.id))
            .returning();

        if (
            input.provider !== undefined &&
            input.provider !== existing.provider
        ) {
            await tx
                .update(espFeedbackConnections)
                .set({ status: "retiring", updatedAt: new Date() })
                .where(
                    and(
                        eq(espFeedbackConnections.espConfigId, existing.id),
                        ne(espFeedbackConnections.status, "retiring"),
                        ne(espFeedbackConnections.status, "disabled"),
                    ),
                );
        }
        return updated;
    });
}

export function updateEspConfig(
    teamId: string,
    espId: string,
    input: UpdateEspConfigInput,
): Promise<EspConfig | null> {
    return updateOwnedEspConfig({ ownerScope: "team", teamId }, espId, input);
}

export function updateOrganizationEspConfig(
    organizationId: string,
    espId: string,
    input: UpdateEspConfigInput,
): Promise<EspConfig | null> {
    return updateOwnedEspConfig(
        { ownerScope: "organization", organizationId },
        espId,
        input,
    );
}

/** Legacy singleton adapter; a newly created row is explicitly selected. */
export async function upsertEspConfig(
    teamId: string,
    input: EspConfigInput,
): Promise<EspConfig> {
    const existing = await getEspConfig(teamId);
    if (existing) {
        return (await updateEspConfig(teamId, existing.espId, input))!;
    }
    const created = await createEspConfig(teamId, {
        ...input,
        name: input.name || "Default ESP",
    });
    await db
        .update(teamDeliverySettings)
        .set({
            defaultSource: "team",
            defaultTeamEspConfigId: created.id,
            updatedAt: new Date(),
        })
        .where(eq(teamDeliverySettings.teamId, teamId));
    return created;
}

async function deleteOwnedEspConfig(config: EspConfig): Promise<boolean> {
    if (config.status !== "draft" || config.activatedAt) {
        throw new Error("delivery_source_in_use");
    }
    return db.transaction(async (tx) => {
        const [grant] = await tx
            .select({ id: espConfigTeamGrants.id })
            .from(espConfigTeamGrants)
            .where(eq(espConfigTeamGrants.espConfigId, config.id))
            .limit(1);
        const [feedback] = await tx
            .select({ id: espFeedbackConnections.id })
            .from(espFeedbackConnections)
            .where(eq(espFeedbackConnections.espConfigId, config.id))
            .limit(1);
        const [sequence] = await tx
            .select({ id: sequences.id })
            .from(sequences)
            .where(eq(sequences.outboxId, config.id))
            .limit(1);
        const [transactional] = await tx
            .select({ id: transactionalEmails.id })
            .from(transactionalEmails)
            .where(eq(transactionalEmails.outboxId, config.id))
            .limit(1);
        if (grant || feedback || sequence || transactional) {
            throw new Error("delivery_source_in_use");
        }
        const deleted = await tx
            .delete(espConfigs)
            .where(eq(espConfigs.id, config.id))
            .returning({ id: espConfigs.id });
        return deleted.length > 0;
    });
}

export async function deleteEspConfig(
    teamId: string,
    espId?: string,
): Promise<boolean> {
    const config = espId
        ? await getEspConfigByEspId(teamId, espId)
        : await getEspConfig(teamId);
    if (!config) return false;
    return deleteOwnedEspConfig(config);
}

export async function deleteOrganizationEspConfig(
    organizationId: string,
    espId: string,
): Promise<boolean> {
    const config = await getOrganizationEspConfigByEspId(organizationId, espId);
    if (!config) return false;
    return deleteOwnedEspConfig(config);
}

export interface DecryptedEspCredentials {
    provider: string;
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    password?: string;
    fromName?: string | null;
    fromEmail?: string | null;
    secretVersion: number;
}

export function decryptEspCredentials(
    config: EspConfig,
): DecryptedEspCredentials {
    let password: string | undefined;
    if (config.encryptedSecret) {
        try {
            password = JSON.parse(
                decryptSecret(config.encryptedSecret),
            ).password;
        } catch {
            password = undefined;
        }
    }
    return {
        provider: config.provider,
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username ?? undefined,
        password,
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        secretVersion: config.secretVersion,
    };
}

export async function getDecryptedEspCredentials(
    teamId: string,
): Promise<DecryptedEspCredentials | null> {
    const config = await getEspConfig(teamId);
    return config ? decryptEspCredentials(config) : null;
}

export async function getDecryptedEspCredentialsById(
    teamId: string,
    id: string,
): Promise<DecryptedEspCredentials | null> {
    const config = await getEspConfigById(id);
    if (!config) return null;
    if (config.ownerScope === "team" && config.teamId !== teamId) return null;
    if (config.ownerScope === "organization") {
        const [grant] = await db
            .select({ id: espConfigTeamGrants.id })
            .from(espConfigTeamGrants)
            .where(
                and(
                    eq(espConfigTeamGrants.teamId, teamId),
                    eq(espConfigTeamGrants.espConfigId, config.id),
                    inArray(espConfigTeamGrants.status, ["active", "draining"]),
                ),
            )
            .limit(1);
        if (!grant) return null;
    }
    return decryptEspCredentials(config);
}

export async function recordEspTestResult(
    ownerId: string,
    status: "success" | "failed",
    error?: string,
    espId?: string,
    ownerScope: EspOwnerScope = "team",
): Promise<void> {
    const config =
        ownerScope === "organization"
            ? espId
                ? await getOrganizationEspConfigByEspId(ownerId, espId)
                : null
            : espId
              ? await getEspConfigByEspId(ownerId, espId)
              : await getEspConfig(ownerId);
    if (!config) return;
    await db
        .update(espConfigs)
        .set({
            lastTestedAt: new Date(),
            lastTestStatus: status,
            lastTestError: error ?? null,
            updatedAt: new Date(),
        })
        .where(eq(espConfigs.id, config.id));
}

export async function transitionEspConfig(
    config: EspConfig,
    action: "activate" | "suspend" | "resume" | "retire",
    options?: { drainUntil?: Date; cancel?: boolean },
): Promise<EspConfig> {
    const now = new Date();
    const values: Partial<typeof espConfigs.$inferInsert> = {
        updatedAt: now,
    };
    if (action === "activate") {
        if (
            config.status !== "draft" ||
            config.lastTestStatus !== "success" ||
            !config.fromEmail
        ) {
            throw new Error("esp_verification_required");
        }
        values.status = "active";
        values.activatedAt = now;
    } else if (action === "suspend") {
        if (config.status !== "active")
            throw new Error("invalid_lifecycle_transition");
        values.status = "suspended";
    } else if (action === "resume") {
        if (config.status !== "suspended")
            throw new Error("invalid_lifecycle_transition");
        values.status = "active";
    } else {
        if (
            !["active", "suspended", "draining"].includes(config.status) ||
            config.status === "retired"
        ) {
            throw new Error("invalid_lifecycle_transition");
        }
        if (options?.cancel) {
            values.status = "retired";
            values.retiredAt = now;
            values.drainUntil = null;
        } else {
            values.status = "draining";
            values.drainUntil =
                options?.drainUntil ??
                new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }
    return db.transaction(async (tx) => {
        const [updated] = await tx
            .update(espConfigs)
            .set(values)
            .where(
                and(
                    eq(espConfigs.id, config.id),
                    ne(espConfigs.status, "retired"),
                ),
            )
            .returning();
        if (!updated) throw new Error("invalid_lifecycle_transition");

        // A forced retirement is terminal. Revoke organization grants and
        // atomically cancel only their unaccepted queued work.
        if (action === "retire" && options?.cancel) {
            const grants = await tx
                .select({
                    id: espConfigTeamGrants.id,
                    teamId: espConfigTeamGrants.teamId,
                })
                .from(espConfigTeamGrants)
                .where(
                    and(
                        eq(espConfigTeamGrants.espConfigId, updated.id),
                        ne(espConfigTeamGrants.status, "revoked"),
                    ),
                )
                .for("update");
            for (const grant of grants) {
                await tx
                    .update(espConfigTeamGrants)
                    .set({
                        status: "revoked",
                        drainUntil: null,
                        updatedAt: now,
                    })
                    .where(eq(espConfigTeamGrants.id, grant.id));
                await cancelQueuedWorkForGrantInTransaction(
                    tx,
                    grant.id,
                    "delivery_source_retired",
                );
                await releaseReservedQuotaForGrantInTransaction(
                    tx,
                    grant.id,
                    "delivery_source_retired",
                );
                await tx
                    .update(teamDeliverySettings)
                    .set({ defaultSource: null, updatedAt: now })
                    .where(
                        and(
                            eq(teamDeliverySettings.teamId, grant.teamId),
                            eq(
                                teamDeliverySettings.defaultSource,
                                "organization",
                            ),
                        ),
                    );
            }

            // Team-owned sources have no organization quota, but their queued
            // deliveries must still be made terminal before the worker sees a
            // retired credential.
            const queued = await tx
                .select({
                    id: outboundMessages.id,
                    transactionalEmailId: outboundMessages.transactionalEmailId,
                })
                .from(outboundMessages)
                .where(
                    and(
                        eq(outboundMessages.espConfigId, updated.id),
                        eq(outboundMessages.deliveryStatus, "queued"),
                    ),
                )
                .for("update");
            if (queued.length) {
                const outboundIds = queued.map((row) => row.id);
                const transactionalIds = queued
                    .map((row) => row.transactionalEmailId)
                    .filter((id): id is string => Boolean(id));
                await tx
                    .update(outboundMessages)
                    .set({ deliveryStatus: "cancelled", updatedAt: now })
                    .where(inArray(outboundMessages.id, outboundIds));
                if (transactionalIds.length) {
                    await tx
                        .update(transactionalEmails)
                        .set({
                            status: "cancelled",
                            error: "delivery_source_retired",
                            updatedAt: now,
                        })
                        .where(
                            and(
                                inArray(
                                    transactionalEmails.id,
                                    transactionalIds,
                                ),
                                eq(transactionalEmails.status, "queued"),
                            ),
                        );
                }
                await tx
                    .update(mailDispatchOutbox)
                    .set({
                        state: "cancelled",
                        lastError: "delivery_source_retired",
                        updatedAt: now,
                    })
                    .where(
                        inArray(
                            mailDispatchOutbox.outboundMessageId,
                            outboundIds,
                        ),
                    );
            }
        }
        return updated;
    });
}
