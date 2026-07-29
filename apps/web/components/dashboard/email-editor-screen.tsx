"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, LogOut } from "lucide-react";
import { Loader } from "@codelitdev/design-system";
import { Button } from "@/components/ui/codelit/button";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import { EmailEditor, type Email } from "@sendlit/email-blocks";
import {
    ImageBlock,
    Link,
    Separator,
    Text,
    type UploaderProps,
} from "@sendlit/email-editor/blocks";
import { EmailImageUploadDialog } from "@/components/dashboard/email-image-upload-dialog";
import {
    createFooterBlock,
    type SendLitEmailRenderContext,
} from "@sendlit/email-blocks/footer";
import type { TemplatePurpose } from "@sendlit/api-contract";
import { getGeneralSettings } from "@/lib/api";

/** Merge tags the API substitutes when sending (see
 * `apps/api/src/automation/process-ongoing-sequence.ts`). */
const MARKETING_VARIABLES = [
    {
        tag: "{{ subscriber.email }}",
        description: "The email of the subscriber",
    },
    {
        tag: "{{ subscriber.name }}",
        description: "The name of the subscriber",
    },
    {
        tag: "{{ subscriber.tags }}",
        description: "The subscriber's tags",
    },
];

function EmailImageUploader({ children, onChange }: UploaderProps) {
    const [open, setOpen] = useState(false);

    return (
        <EmailImageUploadDialog
            open={open}
            setOpen={setOpen}
            onSelect={(image) => onChange(image)}
        >
            {children}
        </EmailImageUploadDialog>
    );
}

const BASE_EMAIL_EDITOR_BLOCKS = [
    Text,
    Separator,
    Link,
    ImageBlock.configure({ uploader: EmailImageUploader }),
];

const SENDLIT_FOOTER_BLOCK = createFooterBlock({
    labels: {
        displayName: "Footer",
        description: "Required mailing address and unsubscribe footer",
        unsubscribe: "Unsubscribe",
        alignment: "Alignment",
        alignmentLeft: "Left",
        alignmentCenter: "Center",
        alignmentRight: "Right",
        foregroundColor: "Text color",
        backgroundColor: "Background color",
        fontSize: "Font size",
        paddingTop: "Top padding",
        paddingBottom: "Bottom padding",
        paddingX: "Horizontal padding",
    },
});

export const MARKETING_EMAIL_EDITOR_BLOCKS = [
    ...BASE_EMAIL_EDITOR_BLOCKS,
    SENDLIT_FOOTER_BLOCK,
];
export const TRANSACTIONAL_EMAIL_EDITOR_BLOCKS = BASE_EMAIL_EDITOR_BLOCKS;

/**
 * Full-screen email editing screen — the only place `EmailEditor` is rendered,
 * mounted under the chrome-free `/editor` layout (no dashboard sidebar). It
 * locks to the viewport: the page itself never scrolls, only the variables
 * panel and the editor's own canvas/settings panes do. Everywhere else shows
 * an `EmailPreview` with an edit button that navigates here; exit returns to
 * wherever the user came from.
 */
export function EmailEditorScreen({
    exitFallbackHref,
    screenTitle = "Editing email",
    initialContent,
    onSave,
    purpose,
    requiredVariables = [],
    saveLabel = "Save",
    header,
}: {
    /** Where exit lands when there's no history to go back to (deep link). */
    exitFallbackHref: string;
    screenTitle?: string;
    initialContent: Email;
    /** Persists the edited content; extra fields owned by `header` controls
     * (e.g. a template's title) are the caller's to include. */
    onSave: (content: Email) => Promise<void>;
    purpose: TemplatePurpose;
    requiredVariables?: string[];
    saveLabel?: string;
    /** Optional controls rendered in the bar above the editor canvas. */
    header?: ReactNode;
}) {
    const router = useRouter();
    // The editor already owns the interactive document state. Keeping its
    // latest value in a ref avoids re-rendering this full-screen shell (and
    // passing a new `email` prop back to the editor) on every keystroke.
    // `save` always reads the current document from this ref.
    const contentRef = useRef(initialContent);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [mailingAddress, setMailingAddress] = useState(
        "Set your mailing address in Settings",
    );

    // A real external content change (for example, navigating to another
    // template without unmounting this screen) remains the source of truth.
    useEffect(() => {
        contentRef.current = initialContent;
    }, [initialContent]);

    useEffect(() => {
        if (purpose !== "marketing") return;
        getGeneralSettings()
            .then((settings) => {
                if (settings.mailingAddress?.trim()) {
                    setMailingAddress(settings.mailingAddress);
                }
            })
            .catch(() => {
                // The API remains authoritative. A preview placeholder keeps
                // editing available while settings are temporarily unavailable.
            });
    }, [purpose]);

    const renderContext = useMemo<SendLitEmailRenderContext | undefined>(
        () =>
            purpose === "marketing"
                ? {
                      footer: {
                          mailingAddress,
                          unsubscribeUrl: "#unsubscribe-preview",
                      },
                  }
                : undefined,
        [mailingAddress, purpose],
    );
    const variables =
        purpose === "marketing"
            ? MARKETING_VARIABLES
            : requiredVariables.map((path) => ({
                  tag: `{{ ${path} }}`,
                  description: "Required transactional variable",
              }));

    const handleContentChange = useCallback((nextContent: Email) => {
        contentRef.current = nextContent;
    }, []);

    function exit() {
        if (window.history.length > 1) {
            router.back();
        } else {
            router.push(exitFallbackHref);
        }
    }

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await onSave(contentRef.current);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to save email",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                        {screenTitle}
                    </span>
                    <Badge variant="secondary" className="capitalize">
                        {purpose}
                    </Badge>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? (
                            <Loader size={16} />
                        ) : saved ? (
                            <Check className="size-4" />
                        ) : null}
                        {saved ? "Saved" : saving ? "Saving…" : saveLabel}
                    </Button>
                    <IconButton
                        variant="outline"
                        onClick={exit}
                        aria-label="Exit editor"
                    >
                        <LogOut className="size-4" />
                    </IconButton>
                </div>
            </header>

            {error && <Banner className="mx-4 mt-4 shrink-0">{error}</Banner>}

            <div className="flex min-h-0 flex-1">
                <aside className="w-64 shrink-0 space-y-4 overflow-y-auto border-r p-4">
                    <h2 className="font-semibold">Variables</h2>
                    <p className="text-sm text-muted-foreground">
                        You can use the following variables in your content.
                    </p>
                    <p className="text-sm text-muted-foreground">
                        These will be replaced with the actual data while
                        sending emails.
                    </p>
                    {variables.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            This template has no required variables.
                        </p>
                    ) : (
                        <dl className="space-y-3">
                            {variables.map((variable) => (
                                <div key={variable.tag} className="space-y-1">
                                    <dt>
                                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                            {variable.tag}
                                        </code>
                                    </dt>
                                    <dd className="text-xs text-muted-foreground">
                                        {variable.description}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </aside>

                <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {header && (
                        <div className="shrink-0 border-b px-6 py-3">
                            {header}
                        </div>
                    )}
                    <div className="min-h-0 flex-1">
                        <EmailEditor
                            email={initialContent}
                            onChange={handleContentChange}
                            blocks={
                                purpose === "marketing"
                                    ? MARKETING_EMAIL_EDITOR_BLOCKS
                                    : TRANSACTIONAL_EMAIL_EDITOR_BLOCKS
                            }
                            renderContext={renderContext}
                        />
                    </div>
                </main>
            </div>
        </div>
    );
}
