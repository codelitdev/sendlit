"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import {
    defaultEmail,
    renderEmailToHtml,
    type Email,
} from "@sendlit/email-editor";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface EmailPreviewProps {
    content: Email | null;
    className?: string;
    minHeight?: string;
    iframeTitle?: string;
    errorPrefix?: string;
    fallbackErrorMessage?: string;
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
    iframeTitle = "Email preview",
    errorPrefix = "Error: ",
    fallbackErrorMessage = "Failed to render email",
}: EmailPreviewProps) {
    const [renderedHTML, setRenderedHTML] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(!!content);
    const [error, setError] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [wrapperWidth, setWrapperWidth] = useState(0);
    const [contentHeight, setContentHeight] = useState<number | null>(null);

    useEffect(() => {
        if (content) {
            const normalizedEmail = normalizeEmailForPreview(content);

            startTransition(() => {
                setRenderedHTML(null);
                setIsLoading(true);
                setError(null);
            });

            renderEmailToHtml({ email: normalizedEmail })
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
    }, [content]);

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
    const scale =
        wrapperWidth > 0 ? Math.min(wrapperWidth / previewWidth, 1) : 1;
    // Before `onLoad` reports the real content height, size as if content
    // exactly filled `minHeight`. Once known, scale that real height down to
    // match what's actually visible — using it unscaled would reserve space
    // for a 1:1 render, leaving a blank gap under the shrunk-down content.
    const previewViewportHeight =
        contentHeight ?? (scale > 0 ? minHeightPx / scale : minHeightPx);
    const previewHeight = contentHeight
        ? previewViewportHeight * scale
        : minHeightPx;

    return (
        <div className={cn("relative", className)}>
            <div
                ref={wrapperRef}
                className="relative w-full overflow-hidden rounded-lg border bg-background"
                style={{ height: `${previewHeight}px` }}
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
                        const doc = event.currentTarget.contentDocument;
                        const measured = doc?.documentElement?.scrollHeight;
                        if (measured) setContentHeight(measured);
                    }}
                />
            </div>
        </div>
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

function normalizeEmailForPreview(content: Email): Email {
    const defaultStyle = defaultEmail.style;

    return {
        ...defaultEmail,
        ...content,
        meta: { ...defaultEmail.meta, ...(content.meta || {}) },
        style: {
            ...defaultStyle,
            ...(content.style || {}),
            colors: {
                ...defaultStyle.colors,
                ...(content.style?.colors || {}),
            },
            typography: {
                ...defaultStyle.typography,
                ...(content.style?.typography || {}),
                header: {
                    ...defaultStyle.typography.header,
                    ...(content.style?.typography?.header || {}),
                },
                text: {
                    ...defaultStyle.typography.text,
                    ...(content.style?.typography?.text || {}),
                },
                link: {
                    ...defaultStyle.typography.link,
                    ...(content.style?.typography?.link || {}),
                },
            },
            interactives: {
                ...defaultStyle.interactives,
                ...(content.style?.interactives || {}),
                button: {
                    ...defaultStyle.interactives.button,
                    ...(content.style?.interactives?.button || {}),
                    padding: {
                        ...defaultStyle.interactives.button.padding,
                        ...(content.style?.interactives?.button?.padding || {}),
                    },
                    border: {
                        ...defaultStyle.interactives.button.border,
                        ...(content.style?.interactives?.button?.border || {}),
                    },
                },
                link: {
                    ...defaultStyle.interactives.link,
                    ...(content.style?.interactives?.link || {}),
                    padding: {
                        ...defaultStyle.interactives.link.padding,
                        ...(content.style?.interactives?.link?.padding || {}),
                    },
                },
            },
            structure: {
                ...defaultStyle.structure,
                ...(content.style?.structure || {}),
                page: {
                    ...defaultStyle.structure.page,
                    ...(content.style?.structure?.page || {}),
                },
                section: {
                    ...defaultStyle.structure.section,
                    ...(content.style?.structure?.section || {}),
                    padding: {
                        ...defaultStyle.structure.section.padding,
                        ...(content.style?.structure?.section?.padding || {}),
                    },
                },
            },
        },
        content: content.content || defaultEmail.content,
    };
}
