import { getSiteUrl } from "../utils/mail";

type WebSettingsRow = { webEnabled: boolean; webHandle: string | null } | null;

/** The hosted archive, or `null` while hosted pages are off. */
export function archiveUrl(settings: WebSettingsRow): string | null {
  return settings?.webEnabled && settings.webHandle
    ? `${getSiteUrl()}/w/${settings.webHandle}`
    : null;
}

/** A published broadcast's hosted page, or `null` when it has none. */
export function issueUrl(
  settings: WebSettingsRow,
  sequence: { webPublished: boolean; webSlug: string | null },
): string | null {
  const archive = archiveUrl(settings);
  return archive && sequence.webPublished && sequence.webSlug
    ? `${archive}/p/${sequence.webSlug}`
    : null;
}
