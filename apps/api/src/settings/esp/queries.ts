import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { espConfigs } from "../../db/schema";
import { decryptSecret, encryptSecret } from "../../utils/secret-crypto";

export type EspConfig = typeof espConfigs.$inferSelect;
export type EspProvider =
    "smtp" | "sendgrid" | "mailgun" | "postmark" | "ses" | "resend" | "custom";

export interface EspConfigInput {
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

export async function getEspConfig(teamId: string): Promise<EspConfig | null> {
    const [row] = await db
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, teamId))
        .limit(1);
    return row ?? null;
}

export async function upsertEspConfig(
    teamId: string,
    input: EspConfigInput,
): Promise<EspConfig> {
    const existing = await getEspConfig(teamId);

    const encryptedSecret =
        input.password === undefined
            ? (existing?.encryptedSecret ?? null)
            : input.password === ""
              ? null
              : encryptSecret(JSON.stringify({ password: input.password }));

    const values = {
        provider: input.provider,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username || null,
        encryptedSecret,
        fromName: input.fromName || null,
        fromEmail: input.fromEmail || null,
        updatedAt: new Date(),
    };

    if (existing) {
        const [row] = await db
            .update(espConfigs)
            .set(values)
            .where(eq(espConfigs.teamId, teamId))
            .returning();
        return row;
    }

    const [row] = await db
        .insert(espConfigs)
        .values({ teamId, ...values })
        .returning();
    return row;
}

export async function deleteEspConfig(teamId: string): Promise<void> {
    await db.delete(espConfigs).where(eq(espConfigs.teamId, teamId));
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

/** Internal use only (mail sending) — includes the decrypted password. */
export async function getDecryptedEspCredentials(
    teamId: string,
): Promise<DecryptedEspCredentials | null> {
    const config = await getEspConfig(teamId);
    if (!config) return null;

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

export async function recordEspTestResult(
    teamId: string,
    status: "success" | "failed",
    error?: string,
): Promise<void> {
    await db
        .update(espConfigs)
        .set({
            lastTestedAt: new Date(),
            lastTestStatus: status,
            lastTestError: error ?? null,
        })
        .where(eq(espConfigs.teamId, teamId));
}
