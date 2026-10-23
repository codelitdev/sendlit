/** Plain-language reasons for SMTP failures caused by the ESP's own settings,
 * in front of the raw error. Ports: 465 starts encrypted ("Use TLS"); 587,
 * 25 and 2525 start plain and upgrade with STARTTLS. */
export function explainSmtpError(
  error: { message?: string; code?: string } | null | undefined,
  config: { port: number; secure: boolean },
): string {
  const raw = error?.message ?? "Unknown error";
  const text = `${error?.code ?? ""} ${raw}`.toLowerCase();
  let reason: string | null = null;
  if (
    config.secure &&
    /wrong[_ ]version[_ ]number|unknown protocol|packet length too long/.test(text)
  ) {
    reason = `Port ${config.port} doesn't start with TLS. Turn off Use TLS (SendLit upgrades with STARTTLS), or switch to port 465.`;
  } else if (
    !config.secure &&
    config.port === 465 &&
    /greeting never received|etimedout|timeout|econnreset|socket close|connection closed/.test(
      text,
    )
  ) {
    reason = "Port 465 needs Use TLS turned on. Turn it on, or switch to port 587.";
  }
  return reason ? `${reason} (${raw})` : raw;
}
