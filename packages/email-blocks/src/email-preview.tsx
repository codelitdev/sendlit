"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import {
    defaultEmail,
    normalizeEmail,
    renderEmailToHtml,
    type BlockComponent,
    type Email,
} from "@sendlit/email-editor";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface EmailPreviewProps {
    content: Email | null;
    className?: string;
    minHeight?: string;
    /** Fixed visible viewport for compact grid previews. Full content remains
     * rendered inside the iframe, but overflow is faded rather than changing
     * surrounding card heights. */
    previewHeight?: string;
    iframeTitle?: string;
    errorPrefix?: string;
    fallbackErrorMessage?: string;
    blocks?: BlockComponent[];
    renderContext?: unknown;
}

/**
 * Renders a scaled-down, real (not a mock/screenshot) preview of an email's
 * content \u2014 the same `renderEmailToHtml` used for actual outgoing mail,
 * dropped into a sandboxed `<iframe srcDoc>` and scaled to fit its container.
 * Ported from CourseLit's `TemplateEmailPreview`
 * (`apps/web/app/.../mails/new/template-email-preview.tsx`); used by
 * `TemplateChooser` so picking a starting template shows what it actually
 * looks like, not just its title.
 */
export function EmailPreview({
    content,
    className,
    minHeight = "420px",
    previewHeight,
    iframeTitle = "Email preview",
    errorPrefix = "Error: ",
    fallbackErrorMessage = "Failed to render email",
    blocks,
    renderContext,
}: EmailPreviewProps) {
    const [renderedHTML, setRenderedHTML] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(!!content);
    const [error, setError] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const contentResizeObserverRef = useRef<ResizeObserver | null>(null);
    const [wrapperWidth, setWrapperWidth] = useState(0);
    const [contentHeight, setContentHeight] = useState<number | null>(null);

    useEffect(() => () => contentResizeObserverRef.current?.disconnect(), []);

    useEffect(() => {
        if (content) {
            const normalizedEmail = normalizeEmailForPreview(content);

            startTransition(() => {
                setRenderedHTML(null);
                setIsLoading(true);
                setError(null);
            });

            renderEmailToHtml({
                email: normalizedEmail,
                blocks,
                renderContext,
            })
                .then((html) => {
                    startTransition(() => {
                        setRenderedHTML(html);
                        setIsLoading(false);
                        setContentHeight(null);
                    });
                })
                .catch((err) => {
                    startTransition(() => {
                        setError(err.message || fallbackErrorMessage);
                        setIsLoading(false);
                    });
                });
        } else {
            startTransition(() => {
                setRenderedHTML(null);
                setIsLoading(false);
                setError(null);
            });
        }
    }, [blocks, content, fallbackErrorMessage, renderContext]);

    useEffect(() => {
        if (!wrapperRef.current) return;

        setWrapperWidth(wrapperRef.current.clientWidth);

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) setWrapperWidth(entry.contentRect.width);
        });

        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, [renderedHTML]);

    if (!content) return null;

    if (isLoading || !renderedHTML) {
        return (
            <Skeleton
                className={cn("w-full rounded-lg", className)}
                style={{ minHeight }}
            />
        );
    }

    if (error) {
        return (
            <div className="text-sm text-destructive">
                {errorPrefix}
                {error}
            </div>
        );
    }

    const normalizedEmail = normalizeEmailForPreview(content);
    const previewWidth = getPreviewWidth(normalizedEmail);
    const minHeightPx = toPixels(minHeight);
    const fixedPreviewHeight = previewHeight ? toPixels(previewHeight) : null;
    const scale =
        wrapperWidth > 0 ? Math.min(wrapperWidth / previewWidth, 1) : 1;
    // Before `onLoad` reports the real content height, size as if content
    // exactly filled `minHeight`. Once known, scale that real height down to
    // match what's actually visible — using it unscaled would reserve space
    // for a 1:1 render, leaving a blank gap under the shrunk-down content.
    const previewViewportHeight =
        contentHeight ?? (scale > 0 ? minHeightPx / scale : minHeightPx);
    const renderedPreviewHeight = contentHeight
        ? previewViewportHeight * scale
        : minHeightPx;
    const visiblePreviewHeight = fixedPreviewHeight ?? renderedPreviewHeight;
    const isOverflowingFixedPreview =
        fixedPreviewHeight !== null &&
        contentHeight !== null &&
        renderedPreviewHeight > fixedPreviewHeight;

    return (
        <div className={cn("relative", className)}>
            <div
                ref={wrapperRef}
                className="relative w-full overflow-hidden rounded-lg border bg-background"
                style={{ height: `${visiblePreviewHeight}px` }}
            >
                <iframe
                    srcDoc={renderedHTML}
                    className="pointer-events-none absolute left-1/2 top-0 border-0"
                    style={{
                        width: `${previewWidth}px`,
                        height: `${previewViewportHeight}px`,
                        transform: `translateX(-50%) scale(${scale})`,
                        transformOrigin: "top center",
                    }}
                    scrolling="no"
                    title={iframeTitle}
                    onLoad={(event) => {
                        const iframe = event.currentTarget;
                        contentResizeObserverRef.current?.disconnect();
                        const measureContentHeight = () => {
                            const measured = getPreviewDocumentHeight(
                                iframe.contentDocument,
                            );
                            if (measured) {
                                setContentHeight((current) =>
                                    current === measured ? current : measured,
                                );
                            }
                        };

                        measureContentHeight();
                        const body = iframe.contentDocument?.body;
                        if (body) {
                            const observer = new ResizeObserver(
                                measureContentHeight,
                            );
                            observer.observe(body);
                            contentResizeObserverRef.current = observer;
                        }
                        window.requestAnimationFrame(measureContentHeight);
                    }}
                />
                {isOverflowingFixedPreview && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent"
                    />
                )}
            </div>
        </div>
    );
}

function getPreviewDocumentHeight(doc: Document | null): number {
    if (!doc) return 0;

    const root = doc.documentElement;
    const body = doc.body;
    return Math.max(
        doc.scrollingElement?.scrollHeight ?? 0,
        root?.scrollHeight ?? 0,
        root?.offsetHeight ?? 0,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
    );
}

function getPreviewWidth(email: Email): number {
    const width =
        email.style?.structure?.page?.width ||
        defaultEmail.style.structure.page.width;
    const parsedWidth = Number.parseInt(width || "600px", 10);
    return Number.isFinite(parsedWidth) ? parsedWidth : 600;
}

function toPixels(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 420;
}

const normalizeEmailForPreview = normalizeEmail;
