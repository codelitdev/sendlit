import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import { getTeamTransport } from "./transport";

const MISSING_TEAM_ESP_ERROR = "Team ESP is not configured.";

interface MailInput {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    /** Required for campaign mail; resolves to the team's configured ESP. */
    teamId: string;
}

async function resolveTeamTransporter(teamId: string) {
    const teamTransporter = await getTeamTransport(teamId);
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
}: MailInput) {
    try {
        if (process.env.NODE_ENV === "production") {
            const transporter = await resolveTeamTransporter(teamId);
            await transporter.sendMail({ from, to, subject, html, headers });
        } else {
            // eslint-disable-next-line no-console
            console.log("Mail sent", from, to, subject, new Date());
        }
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
}: MailInput) {
    const transporter = await resolveTeamTransporter(teamId);
    await transporter.sendMail({ from, to, subject, html });
}
