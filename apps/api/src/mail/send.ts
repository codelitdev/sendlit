import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import { getEspTransport, getTeamTransport } from "./transport";
import { assertMailingAddressConfigured } from "../settings/general/queries";

const MISSING_TEAM_ESP_ERROR = "Team ESP is not configured.";

interface MailInput {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    /** Required for campaign mail; resolves to the team's configured ESP. */
    teamId: string;
    /** Internal id of the user ESP pinned when the send was accepted. */
    espConfigId?: string;
    /** Credential revision included in the transport cache identity. */
    secretVersion?: number;
    /** RFC 5322 `Message-ID` value (no angle brackets — nodemailer adds
     * them). Callers that need webhook correlation generate this up front
     * and persist it on `outbound_messages.rfcMessageId` before calling
     * `sendMail` — see `docs/bounces-and-complaints.md#6-correlation`. */
    messageId?: string;
}

/** What `sendMail` hands back instead of discarding Nodemailer's
 * `SentMessageInfo` — the outbound ledger persists this for later
 * correlation. Both fields are `null` outside production, since `sendMail`
 * only logs there rather than attempting real delivery (`sendTestMail`
 * always attempts real delivery regardless of `NODE_ENV`). */
export interface SendMailResult {
    /** The `Message-ID` actually placed on the outgoing email (normally
     * equal to `<messageId>` when one was supplied). */
    messageId: string | null;
    /** Raw final SMTP response line from the transport — some providers
     * embed their own queue/message id in this text. */
    providerResponse: string | null;
}

async function resolveTeamTransporter(
    teamId: string,
    espConfigId?: string,
    secretVersion?: number,
) {
    const teamTransporter = espConfigId
        ? await getEspTransport(teamId, espConfigId, secretVersion)
        : await getTeamTransport(teamId);
    if (!teamTransporter) {
        throw new Error(MISSING_TEAM_ESP_ERROR);
    }
    return teamTransporter;
}

export async function sendMail({
    from,
    to,
    subject,
    html,
    headers,
    teamId,
    espConfigId,
    secretVersion,
    messageId,
}: MailInput): Promise<SendMailResult> {
    let result: SendMailResult = { messageId: null, providerResponse: null };
    try {
        // This is the final guard for all delivery paths, including queued
        // work accepted before a team clears its address.
        await assertMailingAddressConfigured(teamId);
        const transporter = await resolveTeamTransporter(
            teamId,
            espConfigId,
            secretVersion,
        );
        const info = await transporter.sendMail({
            from,
            to,
            subject,
            html,
            headers,
            messageId,
        });
        result = {
            messageId: info?.messageId ?? null,
            providerResponse: info?.response ?? null,
        };
    } catch (error) {
        captureError({
            error,
            source: "mail.send",
            teamId,
            severity: "critical",
        });
        throw error;
    }

    logger.info({ to, subject, teamId }, "Mail sent");
    captureEvent({
        event: "email_sent",
        source: "mail.send",
        teamId,
    });
    return result;
}

/**
 * Always attempts real delivery regardless of `NODE_ENV` — used for the
 * explicit "send a test email" action so users can verify their ESP
 * configuration actually works before relying on it.
 */
export async function sendTestMail({
    from,
    to,
    subject,
    html,
    teamId,
    espConfigId,
}: MailInput): Promise<void> {
    await assertMailingAddressConfigured(teamId);
    const transporter = await resolveTeamTransporter(teamId, espConfigId);
    await transporter.sendMail({ from, to, subject, html });
}
