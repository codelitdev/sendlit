"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/codelit/textarea";
import { addSuppression } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

/** Manually blocks an address, e.g. a role account or a legal request. */
export function AddSuppressionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await addSuppression(email.trim(), note.trim() || undefined);
      setOpen(false);
      setEmail("");
      setNote("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add the suppression");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add suppression
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress an address</DialogTitle>
          <DialogDescription>
            SendLit won&apos;t send any email from this workspace to the address until
            you release it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="suppression-email">Email address</Label>
            <Input
              id="suppression-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="someone@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suppression-note">Note (optional)</Label>
            <Textarea
              id="suppression-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. asked us to stop emailing them"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !email.trim()}>
            {saving ? "Adding…" : "Suppress"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
