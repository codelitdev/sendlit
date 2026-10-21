/** Port 465 starts encrypted ("Use TLS"); 587 (and 25, 2525) start plain and
 * upgrade with STARTTLS. Mixing them fails with an SSL "wrong version" error
 * or a connection that never answers. */
export function tlsPortMismatch(port: string, secure: boolean): string | null {
  const number = Number(port.trim());
  if (secure && number === 587) {
    return "Port 587 uses STARTTLS, which SendLit does automatically. Turn off Use TLS, or switch to port 465.";
  }
  if (!secure && number === 465) {
    return "Port 465 needs Use TLS turned on. Turn it on, or switch to port 587.";
  }
  return null;
}

/** The port to show after turning Use TLS on or off: swaps the standard
 * port for the other mode (587 ↔ 465) and leaves custom ports alone. */
export function portForTls(port: string, secure: boolean): string {
  const trimmed = port.trim();
  if (secure && (trimmed === "587" || trimmed === "")) return "465";
  if (!secure && trimmed === "465") return "587";
  return port;
}
