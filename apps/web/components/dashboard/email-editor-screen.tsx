"use client";

import { Loader } from "@codelitdev/design-system";
import type { TemplatePurpose } from "@sendlit/api-contract";
import { type Email, EmailEditor } from "@sendlit/email-blocks";
import {
  createFooterBlock,
  type SendLitEmailRenderContext,
} from "@sendlit/email-blocks/footer";
import { normalizeEmail } from "@sendlit/email-editor";
import {
  Columns,
  Conditional,
  HtmlSnippet,
  ImageBlock,
  Link,
  Separator,
  Social,
  Spacer,
  Text,
  type UploaderProps,
} from "@sendlit/email-editor/blocks";
import { Check, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Banner } from "@/components/dashboard/banner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmailImageUploadDialog } from "@/components/dashboard/email-image-upload-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/codelit/button";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { getGeneralSettings } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Merge tags the API substitutes when sending (see
 * `apps/api/src/automation/process-ongoing-sequence.ts`). */
const MARKETING_VARIABLES = [
  {
    tag: "{{ subscriber.email }}",
    description: "The email of the subscriber",
    sample: "priya@example.com",
  },
  {
    tag: "{{ subscriber.name }}",
    description: "The name of the subscriber",
    sample: "Priya",
  },
  {
    tag: "{{ subscriber.tags }}",
    description: "The subscriber's tags",
    sample: "customer, beta",
  },
  {
    tag: "{{ view_in_browser_url }}",
    description: "Link to the web version of this email",
    sample: "[link to web version]",
  },
  {
    tag: "{{ web_version_url }}",
    description:
      "Public web page of this broadcast once published, else its web version",
    sample: "[public page link]",
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
  Spacer,
  Columns,
  Social,
  HtmlSnippet,
];

const SENDLIT_FOOTER_BLOCK = createFooterBlock({
  labels: {
    displayName: "Footer",
    description: "Required mailing address and unsubscribe footer",
    unsubscribe: "Unsubscribe",
    viewInBrowser: "View in browser",
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

// Conditional sections read the subscriber's tags, which only marketing sends have.
export const MARKETING_EMAIL_EDITOR_BLOCKS = [
  ...BASE_EMAIL_EDITOR_BLOCKS,
  Conditional,
  SENDLIT_FOOTER_BLOCK,
];
export const TRANSACTIONAL_EMAIL_EDITOR_BLOCKS = BASE_EMAIL_EDITOR_BLOCKS;

/** What a marketing email's managed footer shows in previews. The "View in
 * browser" link is left out when the sequence has it turned off. */
export function marketingPreviewContext({
  mailingAddress = "Your workspace mailing address",
  viewInBrowser = true,
}: {
  mailingAddress?: string;
  viewInBrowser?: boolean;
} = {}): SendLitEmailRenderContext {
  return {
    footer: {
      mailingAddress,
      unsubscribeUrl: "#unsubscribe-preview",
      ...(viewInBrowser && { viewInBrowserUrl: "#view-in-browser-preview" }),
    },
  };
}

/**
 * Full-screen email editing screen — the only place `EmailEditor` is rendered,
 * mounted under the chrome-free `/editor` layout (no dashboard sidebar). It
 * locks to the viewport: the page itself never scrolls, only the editor's own
 * canvas and style panes do. Everywhere else shows
 * an `EmailPreview` with an edit button that navigates here; exit returns to
 * wherever the user came from.
 */
export function EmailEditorScreen({
  exitFallbackHref,
  title = "Editing email",
  initialContent,
  onSave,
  purpose,
  requiredVariables = [],
  saveLabel = "Save",
  actions,
  viewInBrowser = true,
  extraVariables = [],
  subject,
  onSubjectChange,
  senderName,
  otherChangesUnsaved = false,
}: {
  /** Where exit lands when there's no history to go back to (deep link). */
  exitFallbackHref: string;
  /** The left of the host bar: a label, or a field such as a template's name. */
  title?: ReactNode;
  initialContent: Email;
  /** Persists the edited content; extra fields owned by `title` (e.g. a
   * template's name) are the caller's to include. */
  onSave: (content: Email) => Promise<void>;
  purpose: TemplatePurpose;
  requiredVariables?: string[];
  saveLabel?: string;
  /** Extra top-bar controls. `saveContent` persists the current document
   * (throwing on failure), e.g. before sending a test of it. */
  actions?: (saveContent: () => Promise<void>) => ReactNode;
  /** Whether the footer preview shows the "View in browser" link. */
  viewInBrowser?: boolean;
  /** More merge tags for this email, e.g. `{{ event.* }}` of the custom
   * event that starts its sequence. */
  extraVariables?: { tag: string; description: string }[];
  /** The subject line, written above the email. Saving it is the caller's. */
  subject?: string;
  onSubjectChange?: (subject: string) => void;
  /** The sender shown in the inbox preview. */
  senderName?: string;
  /** Edits the caller saves along with the content, such as the subject or a
   * template's name, that haven't been saved yet. */
  otherChangesUnsaved?: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const normalizedInitialContent = useMemo(
    () => normalizeEmail(initialContent),
    [initialContent],
  );
  // The editor already owns the interactive document state. Keeping its
  // latest value in a ref avoids re-rendering this full-screen shell (and
  // passing a new `email` prop back to the editor) on every keystroke.
  // `save` always reads the current document from this ref.
  const contentRef = useRef(normalizedInitialContent);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Edited since the last save. The editor only reports edits, never its
  // first render, so any change means there's something to lose.
  const contentChanged = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const unsaved = () => contentChanged.current || otherChangesUnsaved;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const [mailingAddress, setMailingAddress] = useState(
    "Set your mailing address in Settings",
  );

  // A real external content change (for example, navigating to another
  // template without unmounting this screen) remains the source of truth.
  useEffect(() => {
    contentRef.current = normalizedInitialContent;
  }, [normalizedInitialContent]);

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
        ? marketingPreviewContext({ mailingAddress, viewInBrowser })
        : undefined,
    [mailingAddress, purpose, viewInBrowser],
  );
  const variables =
    purpose === "marketing"
      ? [...MARKETING_VARIABLES, ...extraVariables]
      : requiredVariables.map((path) => ({
          tag: `{{ ${path} }}`,
          description: "Required transactional variable",
        }));

  const handleContentChange = useCallback((nextContent: Email) => {
    contentRef.current = nextContent;
    contentChanged.current = true;
  }, []);

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsavedRef.current()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Ctrl or Cmd+S saves, as in any editor, instead of saving the page.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function exit() {
    if (unsaved()) setLeaving(true);
    else leave();
  }

  function leave() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(exitFallbackHref);
    }
  }

  /** Saves, returning whether it worked. */
  async function save(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      contentChanged.current = false;
      await onSave(contentRef.current);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err) {
      contentChanged.current = true;
      setError(err instanceof ApiError ? err.message : "Failed to save email");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {typeof title === "string" ? (
            <span className="text-sm text-muted-foreground">{title}</span>
          ) : (
            title
          )}
          <Badge variant="secondary" className="capitalize">
            {purpose}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {actions?.(() => onSave(contentRef.current))}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <Loader size={16} />
            ) : saved ? (
              <Check className="size-4" />
            ) : null}
            {saved ? "Saved" : saving ? "Saving…" : saveLabel}
          </Button>
          <IconButton variant="outline" onClick={exit} aria-label="Exit editor">
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </header>

      {error && <Banner className="mx-4 mt-4 shrink-0">{error}</Banner>}

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You've edited this email since it was last saved. Leaving now discards
              those edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={leave}>
              Discard changes
            </AlertDialogAction>
            <AlertDialogAction
              onClick={async () => {
                if (await save()) leave();
              }}
            >
              Save and exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <EmailEditor
              email={normalizedInitialContent}
              onChange={handleContentChange}
              subject={subject}
              onSubjectChange={onSubjectChange}
              variables={variables}
              senderName={senderName}
              theme={resolvedTheme === "dark" ? "dark" : "sendlit"}
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
