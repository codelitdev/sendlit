import { createTransport } from "nodemailer";
import logger from "../services/log";

/**
 * Comma-separated operator addresses from `envName`. Abuse alerts go to
 * `OPERATOR_ALERT_EMAIL`, falling back to `BILLING_ALERT_EMAIL` so one
 * operator inbox is enough.
 */
export function operatorRecipients(envName: string): string[] {
  return (process.env[envName] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Emails SendLit's operators through the platform SMTP (`EMAIL_*`). Outside
 * production it only logs. */
export async function emailOperators(
  to: string[],
  subject: string,
  text: string,
): Promise<void> {
  if (to.length === 0) return;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_FROM) {
    logger.warn({ subject }, "operator email skipped: SMTP is not configured");
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    logger.info({ to, subject, text }, "[Dev] operator email");
    return;
  }
  const transporter = createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    auth: process.env.EMAIL_USER
      ? {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS || "",
        }
      : undefined,
  });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: to.join(", "),
    subject,
    text,
  });
}
