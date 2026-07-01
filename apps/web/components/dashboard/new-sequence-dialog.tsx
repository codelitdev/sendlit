"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import {
  createSequence,
  listSystemTemplates,
  listTemplates,
  type SystemTemplate,
} from "@/lib/api";
import { TemplateChooser, type EmailTemplate } from "@sendlit/email-blocks";
import type { MailType } from "@sendlit/email-blocks";

export function NewSequenceDialog({
  type,
  label,
  onCreated,
}: {
  type: MailType;
  label: string;
  onCreated: (sequenceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([listSystemTemplates(), listTemplates()])
      .then(([system, own]) => {
        setSystemTemplates(system);
        setTemplates(own);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load templates",
        ),
      )
      .finally(() => setLoading(false));
  }, [open]);

  async function onSelect(choice: { templateId: string }) {
    setSubmitting(true);
    setError(null);
    try {
      const sequence = await createSequence({
        type,
        templateId: choice.templateId,
      });
      setOpen(false);
      onCreated(sequence.sequenceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {error && <Banner>{error}</Banner>}
        <TemplateChooser
          systemTemplates={systemTemplates}
          templates={templates}
          onSelect={onSelect}
          loading={loading || submitting}
        />
      </DialogContent>
    </Dialog>
  );
}
