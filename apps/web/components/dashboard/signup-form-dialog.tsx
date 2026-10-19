"use client";

import { useEffect, useState } from "react";
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
import { createSignupForm, type SignupForm, updateSignupForm } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Creates a signup form, or edits `form` when given. */
export function SignupFormDialog({
  open,
  onOpenChange,
  form,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SignupForm | null;
  onSaved: (form: SignupForm) => void;
}) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [doubleOptIn, setDoubleOptIn] = useState(true);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(form?.name ?? "");
    setTags(form?.tags.join(", ") ?? "");
    setDoubleOptIn(form?.doubleOptIn ?? true);
    setRedirectUrl(form?.redirectUrl ?? "");
    setError(null);
  }, [open, form]);

  async function submit() {
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      doubleOptIn,
      redirectUrl: redirectUrl.trim() || null,
    };
    try {
      const saved = form
        ? await updateSignupForm(form.formId, body)
        : await createSignupForm(body);
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save the form");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form ? "Edit signup form" : "New signup form"}</DialogTitle>
          <DialogDescription>
            People who subscribe through this form are added to your contacts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-name">Name</Label>
            <Input
              id="form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Newsletter signup"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-tags">Tags (comma-separated)</Label>
            <Input
              id="form-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="newsletter, website"
            />
            <p className="text-sm text-muted-foreground">
              Added to everyone who subscribes, so you can target them or start a
              sequence.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="form-double-opt-in"
              checked={doubleOptIn}
              onCheckedChange={setDoubleOptIn}
            />
            <div className="space-y-1">
              <Label htmlFor="form-double-opt-in">Double opt-in</Label>
              <p className="text-sm text-muted-foreground">
                Email a confirmation link and subscribe people only once they click it.
                Recommended: it keeps typos and fake addresses off your list.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-redirect">Redirect after signup (optional)</Label>
            <Input
              id="form-redirect"
              type="url"
              value={redirectUrl}
              onChange={(event) => setRedirectUrl(event.target.value)}
              placeholder="https://example.com/thanks"
            />
            <p className="text-sm text-muted-foreground">
              Leave empty to show SendLit&apos;s thank-you page.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : form ? "Save" : "Create form"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** HTML to paste into any website; it posts to the hosted form's URL. */
export function embedSnippet(form: SignupForm): string {
  return `<form action="${form.url}" method="post">
  <input type="email" name="email" placeholder="you@example.com" required>
  <input type="text" name="name" placeholder="Your name">
  <!-- Leave this hidden field in place: it stops spam bots. -->
  <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">Subscribe</button>
</form>`;
}
