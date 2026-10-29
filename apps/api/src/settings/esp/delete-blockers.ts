/**
 * Why an ESP can't be physically deleted. Each code tells the caller what to
 * do instead, so the REST API, MCP and dashboard explain it the same way.
 */
export const espDeleteBlockerMessages = {
  // The team's live default delivery source.
  esp_is_default:
    "This ESP is the team's default delivery source. Make another source the default, or retire this ESP, before deleting it.",
  // An organization ESP that has been activated is retired, never deleted,
  // so grants and reports keep their source.
  esp_retire_instead:
    "A shared ESP that has been activated can't be deleted. Retire it instead; a retired ESP can't send, and its reports stay intact.",
  // Grants (usage history), a delivery-feedback connection (delivery events)
  // or transactional email point at it, and none of that may be lost.
  esp_has_delivery_history:
    "This ESP has delivery history (transactional email, delivery feedback, or team assignments), so it can't be deleted. Retire it instead; a retired ESP can't send, and its history stays intact.",
  // A sending sequence or broadcast, or queued email, still needs it.
  delivery_source_in_use:
    "This ESP is used by a sending sequence or broadcast, or by queued email. Pause or finish that work, or wait for the queue to drain, then try again.",
} as const;

export type EspDeleteBlocker = keyof typeof espDeleteBlockerMessages;

export function isEspDeleteBlocker(code: unknown): code is EspDeleteBlocker {
  return typeof code === "string" && Object.hasOwn(espDeleteBlockerMessages, code);
}

/** The explanation for a delete blocker, or `undefined` for any other error. */
export function espDeleteBlockerMessage(code: unknown): string | undefined {
  return isEspDeleteBlocker(code) ? espDeleteBlockerMessages[code] : undefined;
}
