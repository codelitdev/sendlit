import { createTransport } from "nodemailer";
import logger from "../services/log";
import { getTeamTransport } from "./transport";

/** Platform default transporter, used when a team hasn't configured
 * their own ESP (see `settings/esp/queries.ts` and `mail/transport.ts`). */
const defaultTransporter = createTransport({
    pool: true,
    maxConnections: 5,
    host: process.env.EMAIL_HOST,
    port: +(process.env.EMAIL_PORT || 587),
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

interface MailInput {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    /** When provided and the team has an ESP configured, mail is sent
     * through the team's own SMTP connection instead of the platform default. */
    teamId?: string;
}

async function resolveTransporter(teamId?: string) {
    if (teamId) {
        const teamTransporter = await getTeamTransport(teamId);
        if (teamTransporter) return teamTransporter;
    }
    return defaultTransporter;
}

export async function sendMail({
    from,
    to,
    subject,
    html,
    headers,
    teamId,
}: MailInput) {
    if (process.env.NODE_ENV === "production") {
        const transporter = await resolveTransporter(teamId);
        await transporter.sendMail({ from, to, subject, html, headers });
    } else {
        // eslint-disable-next-line no-console
        console.log("Mail sent", from, to, subject, new Date());
    }

    logger.info({ to, subject, teamId }, "Mail sent");
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
    const transporter = await resolveTransporter(teamId);
    await transporter.sendMail({ from, to, subject, html });
}
