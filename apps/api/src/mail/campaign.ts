import type { Email as EmailType } from "@sendlit/email-editor";
import { JSDOM } from "jsdom";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { getTeamSettingsRow } from "../settings/general/queries";
import { validateTemplateContent } from "../templates/validation";
import {
  getTrackedClickUrl,
  getTrackingPixelUrl,
  getUnsubLink,
  getViewInBrowserUrl,
} from "../utils/mail";
import { generatePixelToken, verifyPixelToken } from "../utils/pixel-jwt";
import { issueUrl } from "../web/urls";
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

/** What a web-version link opens: the email for one contact, as it was
 * sent when `versionId` (an `email_content_versions.versionId`) is set. Links
 * sent before versions existed have none and show the current content. */
export interface CampaignViewIds extends CampaignEmailIds {
  versionId?: string;
}

/** Web versions stay reachable for as long as an archive would. */
const VIEW_TOKEN_TTL = "3650d";

export function getCampaignViewUrl({ versionId, ...ids }: CampaignViewIds): string {
  return getViewInBrowserUrl(
    generatePixelToken(
      { kind: "view", ...ids, ...(versionId && { v: versionId }) },
      VIEW_TOKEN_TTL,
    ),
  );
}

export function verifyCampaignViewToken(token: string): CampaignViewIds | null {
  const payload = verifyPixelToken<
    Partial<CampaignEmailIds> & { kind?: string; v?: unknown }
  >(token);
  if (
    payload?.kind !== "view" ||
    typeof payload.contactId !== "string" ||
    typeof payload.sequenceId !== "string" ||
    typeof payload.emailId !== "string" ||
    (payload.v !== undefined && typeof payload.v !== "string")
  ) {
    return null;
  }
  return {
    contactId: payload.contactId,
    sequenceId: payload.sequenceId,
    emailId: payload.emailId,
    ...(payload.v && { versionId: payload.v }),
  };
}

/** Stands in for the unsubscribe link on public pages, which have no
 * reader to unsubscribe; the link is removed after rendering. */
const PUBLIC_UNSUBSCRIBE_PLACEHOLDER = "https://sendlit.invalid/unsubscribe";

function withoutUnsubscribeLink(html: string): string {
  const dom = new JSDOM(html);
  for (const anchor of dom.window.document.querySelectorAll(
    `a[href="${PUBLIC_UNSUBSCRIBE_PLACEHOLDER}"]`,
  )) {
    anchor.remove();
  }
  return dom.serialize();
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
  contentVersionId,
  unsubscribeToken,
  web = false,
  publication,
}: {
  team: { id: string; organizationId: string };
  content: unknown;
  subscriber: { email: string; name: string | null; tags: string[] };
  ids: CampaignEmailIds;
  /** Public id of the stored copy of `content`, for the "view in browser"
   * link (`sequences/content-versions.ts`). */
  contentVersionId?: string;
  unsubscribeToken: string;
  /** `"public"`: the published web page, with nobody's data and no
   * unsubscribe link. */
  web?: boolean | "public";
  /** The broadcast's web publishing state, for `{{web_version_url}}`. */
  publication?: { webPublished: boolean; webSlug: string | null } | null;
}): Promise<string> {
  const settings = await getTeamSettingsRow(team.id);
  const publicUrl = publication ? issueUrl(settings, publication) : null;
  // The footer's "view in browser" link goes to the public page once the
  // issue is published, else to the reader's own web version.
  const viewInBrowserUrl = web
    ? undefined
    : (publicUrl ?? getCampaignViewUrl({ ...ids, versionId: contentVersionId }));
  const isPublic = web === "public";
  const variables = {
    subscriber: isPublic ? { email: "", name: null, tags: [] } : subscriber,
    address: settings?.mailingAddress || "",
    unsubscribe_link: isPublic
      ? PUBLIC_UNSUBSCRIBE_PLACEHOLDER
      : getUnsubLink(unsubscribeToken),
    view_in_browser_url: viewInBrowserUrl ?? "",
    web_version_url: publicUrl ?? viewInBrowserUrl ?? "",
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
  if (isPublic) return withoutUnsubscribeLink(renderedHtml);
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
