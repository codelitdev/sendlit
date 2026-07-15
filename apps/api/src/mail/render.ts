import { Liquid } from "liquidjs";
import { JSDOM } from "jsdom";
import {
    renderEmailToHtml,
    type Email as EmailType,
} from "@sendlit/email-editor";
import logger from "../services/log";
import { captureError } from "../observability/posthog";

const liquidEngine = new Liquid();

/**
 * Shared by the campaign send loop (`automation/process-ongoing-sequence.ts`)
 * and the transactional send path: renders `@sendlit/email-editor` block
 * content to HTML, then runs the Liquid merge over it. Callers own what goes
 * into `variables` — the campaign path adds `subscriber`/`address`/
 * `unsubscribe_link`; the transactional path passes exactly the caller's
 * `variables`, nothing else (see `docs/transactional-emails.md`).
 */
export async function renderEmailContent({
    content,
    variables,
}: {
    content: EmailType;
    variables: Record<string, unknown>;
}): Promise<string> {
    const html = await renderEmailToHtml({ email: content });
    return liquidEngine.parseAndRender(html, variables);
}

/** Appends a 1x1 tracking pixel as the last block of the email content,
 * before rendering. */
export function appendTrackingPixel(
    content: EmailType,
    pixelUrl: string,
): EmailType {
    return {
        ...content,
        content: [
            ...content.content,
            {
                blockType: "image",
                settings: {
                    src: pixelUrl,
                    width: "1px",
                    height: "1px",
                    alt: "",
                },
            },
        ],
    };
}

/**
 * Appends a 1x1 tracking pixel directly to already-rendered HTML. Used by the
 * transactional path, where by send time the render step (template block
 * content, or verbatim inline `html`) has already produced a flat HTML
 * string — unlike the campaign path, which appends the pixel as a block
 * (`appendTrackingPixel`) before block content is rendered, because inline
 * `html` sends have no block model to append a block to.
 */
export function appendTrackingPixelToHtml(
    html: string,
    pixelUrl: string,
): string {
    const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
    return /<\/body>/i.test(html)
        ? html.replace(/<\/body>/i, `${pixelTag}</body>`)
        : `${html}${pixelTag}`;
}

/**
 * Rewrites every `<a href>` in rendered HTML to route through the
 * click-tracking redirect, skipping tracking/unsubscribe/`mailto:`/`tel:`/
 * fragment links. `buildTrackedUrl` receives the original URL and the link's
 * index (both feed into the tracking token payload) and returns the
 * replacement href — kept caller-supplied so the campaign and transactional
 * paths can embed different token payloads without this function knowing
 * about either's identifiers.
 */
export function transformLinksForClickTracking(
    htmlContent: string,
    buildTrackedUrl: (originalUrl: string, index: number) => string,
    errorContext: Record<string, unknown> = {},
): string {
    try {
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        const links = document.querySelectorAll("a");

        links.forEach((link, index) => {
            const originalUrl = link.getAttribute("href");
            if (!originalUrl) return;
            if (
                originalUrl.includes("/api/track") ||
                originalUrl.includes("/unsubscribe") ||
                originalUrl.startsWith("mailto:") ||
                originalUrl.startsWith("tel:") ||
                originalUrl.startsWith("#")
            ) {
                return;
            }

            link.setAttribute("href", buildTrackedUrl(originalUrl, index));
        });

        return dom.serialize();
    } catch (error: any) {
        logger.error(
            { error: error.message },
            "transformLinksForClickTracking failed",
        );
        captureError({
            error,
            source: "mail.click_tracking_transform",
            severity: "warning",
            context: errorContext,
        });
        return htmlContent;
    }
}
