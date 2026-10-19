"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/codelit/button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import { Switch } from "@/components/ui/codelit/switch";
import { Textarea } from "@/components/ui/codelit/textarea";
import {
  getWebSettings,
  listSignupForms,
  type SignupForm,
  updateWebSettings,
  type WebSettings,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ERRORS: Record<string, string> = {
  handle_taken: "Another workspace already uses this handle.",
};
const NO_FORM = "none";

/** The team's public archive of broadcasts published to the web. */
export function WebArchiveSettings() {
  const [settings, setSettings] = useState<WebSettings | null>(null);
  const [forms, setForms] = useState<SignupForm[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formId, setFormId] = useState(NO_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(value: WebSettings) {
    setSettings(value);
    setEnabled(value.enabled);
    setHandle(value.handle ?? "");
    setTitle(value.title ?? "");
    setDescription(value.description ?? "");
    setFormId(value.signupFormId ?? NO_FORM);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    Promise.all([getWebSettings(), listSignupForms()])
      .then(([web, signupForms]) => {
        apply(web);
        setForms(signupForms.items);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load"),
      );
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await updateWebSettings({
        enabled,
        ...(handle.trim() && { handle: handle.trim() }),
        title: title.trim() || null,
        description: description.trim() || null,
        ...(formId !== NO_FORM || settings?.signupFormId
          ? { signupFormId: formId === NO_FORM ? null : formId }
          : {}),
      });
      apply(next);
      // A form may have been created for the archive.
      setForms((await listSignupForms()).items);
      setSaved(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      setError(ERRORS[message] ?? message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings && !error) return <Loading className="p-6" />;

  return (
    <div className="space-y-4">
      {error && <Banner>{error}</Banner>}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web archive</CardTitle>
          <p className="text-sm text-muted-foreground">
            Broadcasts you publish to the web get their own page, listed in a public
            archive with a signup form, an RSS feed and a sitemap for search engines.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch id="web-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <div className="space-y-1">
              <Label htmlFor="web-enabled">Host the archive on SendLit</Label>
              <p className="text-sm text-muted-foreground">
                Turn off if your own site shows the issues through the API.
              </p>
            </div>
          </div>
          {settings?.archiveUrl && (
            <div className="flex flex-wrap gap-4 text-sm">
              <a
                href={settings.archiveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                {settings.archiveUrl}
                <ExternalLink className="size-3" />
              </a>
              {settings.rssUrl && (
                <a
                  href={settings.rssUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  RSS feed
                </a>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="web-handle">Handle</Label>
            <Input
              id="web-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              placeholder="made from the workspace name"
            />
            <p className="text-sm text-muted-foreground">
              The archive lives at /w/
              <span className="font-mono">{handle || "handle"}</span>. Changing it
              breaks existing links.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-title">Title</Label>
            <Input
              id="web-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="defaults to the workspace name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-description">Description</Label>
            <Textarea
              id="web-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-form">Signup form</Label>
            <Select value={formId} onValueChange={setFormId}>
              <SelectTrigger id="web-form" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FORM}>
                  {enabled && !settings?.signupFormId ? "Create one" : "None"}
                </SelectItem>
                {forms.map((form) => (
                  <SelectItem key={form.formId} value={form.formId}>
                    {form.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Shown on the archive and under each issue. New subscribers get its tags
              and start your &quot;subscriber added&quot; sequences.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={save} disabled={saving}>
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
