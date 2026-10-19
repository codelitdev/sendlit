"use client";

import { ExternalLink, Globe } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { Switch } from "@/components/ui/codelit/switch";
import { Textarea } from "@/components/ui/codelit/textarea";
import {
  getBroadcastWebPublishing,
  updateBroadcastWebPublishing,
  type WebPublishing,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ERRORS: Record<string, string> = {
  slug_taken: "Another issue already uses this URL slug.",
};

/** Publishes a broadcast as a public web page and edits its SEO fields. */
export function BroadcastWebDialog({ sequenceId }: { sequenceId: string }) {
  const [open, setOpen] = useState(false);
  const [web, setWeb] = useState<WebPublishing | null>(null);
  const [published, setPublished] = useState(false);
  const [slug, setSlug] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogImage, setOgImage] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noindex, setNoindex] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(value: WebPublishing) {
    setWeb(value);
    setPublished(value.published);
    setSlug(value.slug ?? "");
    setSeoTitle(value.seoTitle ?? "");
    setSeoDescription(value.seoDescription ?? "");
    setOgImage(value.ogImage ?? "");
    setCanonicalUrl(value.canonicalUrl ?? "");
    setNoindex(value.noindex);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    getBroadcastWebPublishing(sequenceId)
      .then(apply)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load"),
      );
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      apply(
        await updateBroadcastWebPublishing(sequenceId, {
          published,
          ...(slug.trim() && { slug: slug.trim() }),
          seoTitle: seoTitle.trim() || null,
          seoDescription: seoDescription.trim() || null,
          ogImage: ogImage.trim() || null,
          canonicalUrl: canonicalUrl.trim() || null,
          noindex,
        }),
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      setError(ERRORS[message] ?? message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Globe className="size-4" />
        Web page
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Web page</DialogTitle>
          <DialogDescription>
            Publish this broadcast as a public page in your web archive. It goes live
            once the broadcast is sent, without anyone&apos;s personal data, tracking or
            unsubscribe link.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="web-published"
              checked={published}
              onCheckedChange={setPublished}
            />
            <Label htmlFor="web-published">Publish to the web</Label>
            {web?.live && <Badge variant="success">Live</Badge>}
            {web?.published && !web.live && (
              <Badge variant="secondary">Live once sent</Badge>
            )}
          </div>
          {web?.url && web.published && (
            <a
              href={web.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-sm underline underline-offset-4"
            >
              {web.url}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          )}
          {web && !web.url && published && (
            <p className="text-sm text-muted-foreground">
              Hosted pages are off. Turn them on in{" "}
              <Link href="/settings?tab=web" className="underline underline-offset-4">
                Settings → Web archive
              </Link>
              , or show the issue on your own site through the API.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="web-slug">URL slug</Label>
            <Input
              id="web-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              placeholder="made from the title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-seo-title">SEO title</Label>
            <Input
              id="web-seo-title"
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
              placeholder="defaults to the broadcast title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-seo-description">Description</Label>
            <Textarea
              id="web-seo-description"
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
              placeholder="defaults to the start of the email"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-og-image">Social image URL</Label>
            <Input
              id="web-og-image"
              type="url"
              value={ogImage}
              onChange={(event) => setOgImage(event.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-canonical">Canonical URL</Label>
            <Input
              id="web-canonical"
              type="url"
              value={canonicalUrl}
              onChange={(event) => setCanonicalUrl(event.target.value)}
              placeholder="only if the issue also lives on your own site"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="web-noindex" checked={noindex} onCheckedChange={setNoindex} />
            <Label htmlFor="web-noindex">Hide from search engines</Label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Close
          </Button>
          <Button onClick={save} disabled={saving || !web}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
