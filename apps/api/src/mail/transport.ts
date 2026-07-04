import { createTransport, type Transporter } from "nodemailer";
import { getDecryptedEspCredentials } from "../settings/esp/queries";

const transportCache = new Map<string, Transporter>();

/** Call after a team's ESP config changes so the next send picks up the
 * new settings instead of a stale cached connection. */
export function invalidateTeamTransport(teamId: string): void {
  const cached = transportCache.get(teamId);
  if (cached) cached.close();
  transportCache.delete(teamId);
}

/** Returns the team's own SMTP transporter if they've configured an ESP,
 * or `null` if they haven't (callers should fall back to the platform default). */
export async function getTeamTransport(
  teamId: string,
): Promise<Transporter | null> {
  const cached = transportCache.get(teamId);
  if (cached) return cached;

  const creds = await getDecryptedEspCredentials(teamId);
  if (!creds) return null;

  const transporter = createTransport({
    pool: true,
    maxConnections: 5,
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: creds.username
      ? { user: creds.username, pass: creds.password || "" }
      : undefined,
  });
  transportCache.set(teamId, transporter);
  return transporter;
}
