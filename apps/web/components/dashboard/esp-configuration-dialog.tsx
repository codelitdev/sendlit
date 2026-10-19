"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
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
import type { EspConfig, EspConnectionInput, EspProvider } from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const PROVIDERS: Array<{ value: EspProvider; label: string }> = [
  { value: "smtp", label: "Custom SMTP" },
  { value: "sendgrid", label: "SendGrid" },
  { value: "mailgun", label: "Mailgun" },
  { value: "postmark", label: "Postmark" },
  { value: "ses", label: "Amazon SES" },
  { value: "resend", label: "Resend" },
];

type FormState = {
  name: string;
  provider: EspProvider;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

const emptyForm: FormState = {
  name: "",
  provider: "smtp",
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
};

function formFor(esp: EspConfig | null): FormState {
  if (!esp) return emptyForm;
  return {
    name: esp.name,
    provider: esp.provider,
    host: esp.host,
    port: String(esp.port),
    secure: esp.secure,
    username: esp.username ?? "",
    password: "",
    fromName: esp.fromName ?? "",
    fromEmail: esp.fromEmail ?? "",
    replyTo: esp.replyTo ?? "",
  };
}

export function EspConfigurationDialog({
  open,
  esp,
  onOpenChange,
  onSubmit,
  createTitle = "New ESP",
  editTitle,
  createLabel = "Create ESP",
  saveLabel = "Save ESP",
  namePlaceholder = "e.g. Marketing SMTP",
}: {
  open: boolean;
  esp: EspConfig | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: EspConnectionInput & { name: string }) => Promise<void>;
  createTitle?: string;
  editTitle?: (esp: EspConfig) => string;
  createLabel?: string;
  saveLabel?: string;
  namePlaceholder?: string;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFor(esp));
    setError(null);
  }, [open, esp]);

  async function submit() {
    const port = Number(form.port);
    const fromEmail = form.fromEmail.trim();
    if (
      !form.name.trim() ||
      !form.host.trim() ||
      !fromEmail ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      setError("Enter a valid sender email address.");
      return;
    }
    const replyTo = form.replyTo.trim();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
      setError("Enter a valid reply-to email address.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        provider: form.provider,
        host: form.host.trim(),
        port,
        secure: form.secure,
        username: form.username.trim() || undefined,
        ...(form.password ? { password: form.password } : {}),
        fromName: form.fromName.trim() || undefined,
        fromEmail,
        // "" clears a previously saved reply-to on edit.
        ...(replyTo || esp?.replyTo ? { replyTo } : {}),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save ESP");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {esp ? (editTitle?.(esp) ?? `Edit ${esp.name}`) : createTitle}
          </DialogTitle>
        </DialogHeader>
        {error && <Banner>{error}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="esp-name">Name</Label>
            <Input
              id="esp-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={namePlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={form.provider}
              onValueChange={(provider) =>
                setForm({
                  ...form,
                  provider: provider as EspProvider,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-host">SMTP host</Label>
            <Input
              id="esp-host"
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-port">Port</Label>
            <Input
              id="esp-port"
              inputMode="numeric"
              value={form.port}
              onChange={(event) => setForm({ ...form, port: event.target.value })}
              placeholder="587"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-username">Username</Label>
            <Input
              id="esp-username"
              value={form.username}
              onChange={(event) =>
                setForm({
                  ...form,
                  username: event.target.value,
                })
              }
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-password">
              {esp ? "Password / API key (leave blank to keep)" : "Password / API key"}
            </Label>
            <Input
              id="esp-password"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm({
                  ...form,
                  password: event.target.value,
                })
              }
              placeholder={
                esp?.hasPassword ? "•••••••• (saved — leave blank to keep)" : undefined
              }
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-from-name">From name</Label>
            <Input
              id="esp-from-name"
              value={form.fromName}
              onChange={(event) =>
                setForm({
                  ...form,
                  fromName: event.target.value,
                })
              }
              placeholder="Your name or company"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-from-email">From email</Label>
            <Input
              id="esp-from-email"
              type="email"
              value={form.fromEmail}
              onChange={(event) =>
                setForm({
                  ...form,
                  fromEmail: event.target.value,
                })
              }
              placeholder="you@yourdomain.com"
            />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label htmlFor="esp-reply-to">Reply-to email (optional)</Label>
            <Input
              id="esp-reply-to"
              type="email"
              value={form.replyTo}
              onChange={(event) =>
                setForm({
                  ...form,
                  replyTo: event.target.value,
                })
              }
              placeholder="support@yourdomain.com"
            />
            <p className="text-sm text-muted-foreground">
              Replies go here instead of the from address.
            </p>
          </div>
          <div className="col-span-full flex items-center gap-3">
            <Switch
              id="esp-secure"
              checked={form.secure}
              onCheckedChange={(secure) => setForm({ ...form, secure })}
            />
            <Label htmlFor="esp-secure">Use TLS (port 465)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              saving || !form.name.trim() || !form.host.trim() || !form.fromEmail.trim()
            }
          >
            {saving ? "Saving…" : esp ? saveLabel : createLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
