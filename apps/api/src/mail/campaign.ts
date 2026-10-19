import type { Email as EmailType } from "@sendlit/email-editor";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { getGeneralSettings } from "../settings/general/queries";
import { validateTemplateContent } from "../templates/validation";
import { getTrackedClickUrl, getTrackingPixelUrl, getUnsubLink } from "../utils/mail";
import { generatePixelToken } from "../utils/pixel-jwt";
import {
  appendTrackingPixel,
  renderEmailContent,
  transformLinksForClickTracking,
} from "./render";

/**
 * Renders a broadcast or sequence email for one recipient: liquid merge tags,
 * the managed footer, the open pixel and click-tracked links. Real sends and
 * test sends both go through here so a test looks exactly like the real thing.
 */
export async function renderCampaignHtml({
  team,
  content,
  subscriber,
  contactId,
  unsubscribeToken,
  sequenceId,
  emailId,
}: {
  team: { id: string; organizationId: string };
  content: unknown;
  subscriber: { email: string; name: string | null; tags: string[] };
  /** Public ids embedded in tracking tokens; `tracking/routes.ts` resolves
   * them later with no other context. */
  contactId: string;
  unsubscribeToken: string;
  sequenceId: string;
  emailId: string;
}): Promise<string> {
  const generalSettings = await getGeneralSettings(team.id);
  const variables = {
    subscriber,
    address: generalSettings.mailingAddress || "",
    unsubscribe_link: getUnsubLink(unsubscribeToken),
  };

  const pixelUrl = getTrackingPixelUrl(
    generatePixelToken({ contactId, sequenceId, emailId }),
  );
  const contentWithPixel = appendTrackingPixel(content as EmailType, pixelUrl);
  // Stored sequence content is normally validated on every write. Recheck
  // at the delivery boundary as defense in depth so corrupted/manual DB
  // content can never bypass the managed final-footer invariant.
  validateTemplateContent(contentWithPixel, "marketing");

  const renderedHtml = await renderEmailContent({
    content: contentWithPixel,
    variables,
    brandingText: (await getOrganizationEntitlements(team.organizationId))
      .marketingBranding
      ? "Sent with SendLit"
      : undefined,
  });

  return transformLinksForClickTracking(
    renderedHtml,
    (originalUrl, index) =>
      getTrackedClickUrl(
        generatePixelToken({
          contactId,
          sequenceId,
          emailId,
          index,
          link: encodeURIComponent(originalUrl),
        }),
      ),
    { sequence_id: sequenceId, email_id: emailId },
  );
}
