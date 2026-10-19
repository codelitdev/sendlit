import type { Email as EmailType } from "@sendlit/email-editor";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { getGeneralSettings } from "../settings/general/queries";
import { validateTemplateContent } from "../templates/validation";
import {
  getTrackedClickUrl,
  getTrackingPixelUrl,
  getUnsubLink,
  getViewInBrowserUrl,
} from "../utils/mail";
import { generatePixelToken, verifyPixelToken } from "../utils/pixel-jwt";
import {
  appendTrackingPixel,
  renderEmailContent,
  transformLinksForClickTracking,
} from "./render";

/** Public ids a campaign email's tracking and web-view tokens carry;
 * `tracking/routes.ts` and `GET /view/:token` resolve them later with no
 * other context. */
export interface CampaignEmailIds {
  contactId: string;
  sequenceId: string;
  emailId: string;
}

/** Web versions stay reachable for as long as an archive would. */
const VIEW_TOKEN_TTL = "3650d";

export function getCampaignViewUrl(ids: CampaignEmailIds): string {
  return getViewInBrowserUrl(
    generatePixelToken({ kind: "view", ...ids }, VIEW_TOKEN_TTL),
  );
}

export function verifyCampaignViewToken(token: string): CampaignEmailIds | null {
  const payload = verifyPixelToken<Partial<CampaignEmailIds> & { kind?: string }>(
    token,
  );
  if (
    payload?.kind !== "view" ||
    typeof payload.contactId !== "string" ||
    typeof payload.sequenceId !== "string" ||
    typeof payload.emailId !== "string"
  ) {
    return null;
  }
  return {
    contactId: payload.contactId,
    sequenceId: payload.sequenceId,
    emailId: payload.emailId,
  };
}

/**
 * Renders a broadcast or sequence email for one recipient: liquid merge tags
 * and the managed footer. For a send (`web: false`) it also adds the open
 * pixel, click-tracked links and the "view in browser" link
 * (`{{view_in_browser_url}}`). The web version (`web: true`) has none of
 * those. Real sends, test sends and the web version all go through here so
 * they look the same.
 */
export async function renderCampaignHtml({
  team,
  content,
  subscriber,
  ids,
  unsubscribeToken,
  web = false,
}: {
  team: { id: string; organizationId: string };
  content: unknown;
  subscriber: { email: string; name: string | null; tags: string[] };
  ids: CampaignEmailIds;
  unsubscribeToken: string;
  web?: boolean;
}): Promise<string> {
  const generalSettings = await getGeneralSettings(team.id);
  const viewInBrowserUrl = web ? undefined : getCampaignViewUrl(ids);
  const variables = {
    subscriber,
    address: generalSettings.mailingAddress || "",
    unsubscribe_link: getUnsubLink(unsubscribeToken),
    view_in_browser_url: viewInBrowserUrl ?? "",
  };

  const renderedContent = web
    ? (content as EmailType)
    : appendTrackingPixel(
        content as EmailType,
        getTrackingPixelUrl(generatePixelToken({ ...ids })),
      );
  // Stored sequence content is normally validated on every write. Recheck
  // at the delivery boundary as defense in depth so corrupted/manual DB
  // content can never bypass the managed final-footer invariant.
  validateTemplateContent(renderedContent, "marketing");

  const renderedHtml = await renderEmailContent({
    content: renderedContent,
    variables,
    viewInBrowserUrl,
    brandingText: (await getOrganizationEntitlements(team.organizationId))
      .marketingBranding
      ? "Sent with SendLit"
      : undefined,
  });
  if (web) return renderedHtml;

  return transformLinksForClickTracking(
    renderedHtml,
    (originalUrl, index) =>
      getTrackedClickUrl(
        generatePixelToken({
          ...ids,
          index,
          link: encodeURIComponent(originalUrl),
        }),
      ),
    { sequence_id: ids.sequenceId, email_id: ids.emailId },
  );
}
