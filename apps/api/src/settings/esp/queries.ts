import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db/client";
import {
    espConfigs,
    espFeedbackConnections,
    sequences,
    transactionalEmails,
} from "../../db/schema";
import { decryptSecret, encryptSecret } from "../../utils/secret-crypto";

export type EspConfig = typeof espConfigs.$inferSelect;
export type EspProvider =
    "smtp" | "sendgrid" | "mailgun" | "postmark" | "ses" | "resend" | "custom";

export interface EspConnectionInput {
    provider: EspProvider;
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    /** `undefined` = keep the existing secret unchanged; `""` = clear it. */
    password?: string;
    fromName?: string;
    fromEmail?: string;
}

export interface CreateEspConfigInput extends EspConnectionInput {
    name: string;
    isDefault?: boolean;
}

export type UpdateEspConfigInput = Partial<CreateEspConfigInput> & {
    /** A default can only be replaced by promoting another config. */
    isDefault?: true;
};

/** Backward-compatible singleton input used by `/settings/esp`. */
export type EspConfigInput = EspConnectionInput & { name?: string };

export async function listEspConfigs(teamId: string): Promise<EspConfig[]> {
    return db
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, teamId))
        .orderBy(asc(espConfigs.createdAt));
}

/** Returns the team's default user-managed ESP, never an arbitrary row. */
export async function getEspConfig(teamId: string): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            and(eq(espConfigs.teamId, teamId), eq(espConfigs.isDefault, true)),
        )
        .limit(1);
    return row ?? null;
}

export async function getEspConfigByEspId(
    teamId: string,
    espId: string,
): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(and(eq(espConfigs.teamId, teamId), eq(espConfigs.espId, espId)))
        .limit(1);
    return row ?? null;
}

/** Internal-id lookup used only by pinned delivery paths. */
export async function getEspConfigById(
    id: string,
    teamId?: string,
): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(
            teamId
                ? and(eq(espConfigs.id, id), eq(espConfigs.teamId, teamId))
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

function encryptedSecretForInput(
    password: string | undefined,
    existing?: EspConfig | null,
): string | null {
    if (password === undefined) return existing?.encryptedSecret ?? null;
    if (password === "") return null;
    return encryptSecret(JSON.stringify({ password }));
}

export async function createEspConfig(
    teamId: string,
    input: CreateEspConfigInput,
): Promise<EspConfig> {
    return db.transaction(async (tx) => {
        const existing = await tx
            .select({ id: espConfigs.id })
            .from(espConfigs)
            .where(eq(espConfigs.teamId, teamId))
            .limit(1);
        const isDefault = input.isDefault === true || existing.length === 0;
        if (isDefault) {
            await tx
                .update(espConfigs)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(eq(espConfigs.teamId, teamId));
        }

        const [row] = await tx
            .insert(espConfigs)
            .values({
                teamId,
                name: input.name,
                isDefault,
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
    });
}

export async function updateEspConfig(
    teamId: string,
    espId: string,
    input: UpdateEspConfigInput,
): Promise<EspConfig | null> {
    const row = await db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(espConfigs)
            .where(
                and(eq(espConfigs.teamId, teamId), eq(espConfigs.espId, espId)),
            )
            .limit(1);
        if (!existing) return null;

        if (input.isDefault === true) {
            await tx
                .update(espConfigs)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(eq(espConfigs.teamId, teamId));
        }

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
        if (input.isDefault === true) values.isDefault = true;

        const [updated] = await tx
            .update(espConfigs)
            .set(values)
            .where(eq(espConfigs.id, existing.id))
            .returning();

        // A provider change retires the feedback connection bound to the
        // old provider's webhook/verification scheme — it can never serve
        // the new provider, so a later `PUT .../feedback` call creates a
        // fresh one instead of mutating this one in place (see
        // docs/bounces-and-complaints.md#2-feedback-connection). Changing
        // name, sender identity, or the default flag never does this.
        // Inlined here (rather than calling into
        // delivery-feedback/feedback-connection-queries.ts) so the retire
        // commits atomically with the provider change.
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
    return row;
}

/** Backward-compatible create/update of the default user ESP. */
export async function upsertEspConfig(
    teamId: string,
    input: EspConfigInput,
): Promise<EspConfig> {
    const existing = await getEspConfig(teamId);
    if (existing) {
        return (await updateEspConfig(teamId, existing.espId, input))!;
    }
    return createEspConfig(teamId, {
        ...input,
        name: input.name || "Default ESP",
        isDefault: true,
    });
}

export async function deleteEspConfig(
    teamId: string,
    espId?: string,
): Promise<boolean> {
    return db.transaction(async (tx) => {
        const [config] = await tx
            .select()
            .from(espConfigs)
            .where(
                espId
                    ? and(
                          eq(espConfigs.teamId, teamId),
                          eq(espConfigs.espId, espId),
                      )
                    : and(
                          eq(espConfigs.teamId, teamId),
                          eq(espConfigs.isDefault, true),
                      ),
            )
            .limit(1);
        if (!config) return false;

        const [referencedSequence] = await tx
            .select({ id: sequences.id })
            .from(sequences)
            .where(
                and(
                    eq(sequences.outboxId, config.id),
                    inArray(sequences.status, ["active", "paused"]),
                ),
            )
            .limit(1);
        const [queuedEmail] = await tx
            .select({ id: transactionalEmails.id })
            .from(transactionalEmails)
            .where(
                and(
                    eq(transactionalEmails.outboxId, config.id),
                    eq(transactionalEmails.status, "queued"),
                ),
            )
            .limit(1);
        if (referencedSequence || queuedEmail) throw new Error("esp_in_use");

        // Retire the feedback connection *before* deleting the ESP — the
        // FK's `ON DELETE SET NULL` will null `espConfigId` once the row is
        // gone, after which it can no longer be found by it. Retiring here
        // (rather than deleting/disabling) keeps historical events and
        // suppressions correlatable and accepts late events during the
        // grace period, per docs/bounces-and-complaints.md#2-feedback-connection.
        await tx
            .update(espFeedbackConnections)
            .set({ status: "retiring", updatedAt: new Date() })
            .where(
                and(
                    eq(espFeedbackConnections.espConfigId, config.id),
                    ne(espFeedbackConnections.status, "retiring"),
                    ne(espFeedbackConnections.status, "disabled"),
                ),
            );

        await tx.delete(espConfigs).where(eq(espConfigs.id, config.id));
        if (config.isDefault) {
            const [replacement] = await tx
                .select({ id: espConfigs.id })
                .from(espConfigs)
                .where(eq(espConfigs.teamId, teamId))
                .orderBy(asc(espConfigs.createdAt))
                .limit(1);
            if (replacement) {
                await tx
                    .update(espConfigs)
                    .set({ isDefault: true, updatedAt: new Date() })
                    .where(eq(espConfigs.id, replacement.id));
            }
        }
        return true;
    });
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
}

function decryptCredentials(config: EspConfig): DecryptedEspCredentials {
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
    };
}

/** Backward-compatible credential lookup for the default user ESP. */
export async function getDecryptedEspCredentials(
    teamId: string,
): Promise<DecryptedEspCredentials | null> {
    const config = await getEspConfig(teamId);
    return config ? decryptCredentials(config) : null;
}

export async function getDecryptedEspCredentialsById(
    teamId: string,
    id: string,
): Promise<DecryptedEspCredentials | null> {
    const config = await getEspConfigById(id, teamId);
    return config ? decryptCredentials(config) : null;
}

export async function recordEspTestResult(
    teamId: string,
    status: "success" | "failed",
    error?: string,
    espId?: string,
): Promise<void> {
    const config = espId
        ? await getEspConfigByEspId(teamId, espId)
        : await getEspConfig(teamId);
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
