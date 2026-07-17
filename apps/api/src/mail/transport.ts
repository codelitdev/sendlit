import { createTransport, type Transporter } from "nodemailer";
import {
    getDecryptedEspCredentials,
    getDecryptedEspCredentialsById,
} from "../settings/esp/queries";

const transportCache = new Map<string, Transporter>();

function cacheKey(teamId: string, espConfigId: string): string {
    return `${teamId}:${espConfigId}`;
}

/** Call after a team's ESP config changes so the next send picks up the
 * new settings instead of a stale cached connection. */
export function invalidateTeamTransport(teamId: string): void {
    for (const [key, cached] of transportCache.entries()) {
        if (!key.startsWith(`${teamId}:`)) continue;
        cached.close();
        transportCache.delete(key);
    }
}

export function invalidateEspTransport(
    teamId: string,
    espConfigId: string,
): void {
    const key = cacheKey(teamId, espConfigId);
    transportCache.get(key)?.close();
    transportCache.delete(key);
}

function createEspTransport(
    creds: NonNullable<
        Awaited<ReturnType<typeof getDecryptedEspCredentialsById>>
    >,
): Transporter {
    return createTransport({
        pool: true,
        maxConnections: 5,
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth: creds.username
            ? { user: creds.username, pass: creds.password || "" }
            : undefined,
    });
}

export async function getEspTransport(
    teamId: string,
    espConfigId: string,
): Promise<Transporter | null> {
    const key = cacheKey(teamId, espConfigId);
    const cached = transportCache.get(key);
    if (cached) return cached;

    const creds = await getDecryptedEspCredentialsById(teamId, espConfigId);
    if (!creds) return null;
    const transporter = createEspTransport(creds);
    transportCache.set(key, transporter);
    return transporter;
}

/** Returns the team's own SMTP transporter if they've configured an ESP,
 * or `null` if they haven't. */
export async function getTeamTransport(
    teamId: string,
): Promise<Transporter | null> {
    // Compatibility callers address the default by team. Cache separately so
    // switching the default and invalidating the team cannot retain stale SMTP.
    const key = cacheKey(teamId, "default");
    const cached = transportCache.get(key);
    if (cached) return cached;
    const creds = await getDecryptedEspCredentials(teamId);
    if (!creds) return null;
    const transporter = createEspTransport(creds);
    transportCache.set(key, transporter);
    return transporter;
}
