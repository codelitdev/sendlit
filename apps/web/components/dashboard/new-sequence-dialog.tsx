"use client";

import type { MailType } from "@sendlit/email-blocks";
import { type EmailTemplate, TemplateChooser } from "@sendlit/email-blocks";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { DeliverySourcePicker } from "@/components/dashboard/delivery-source-picker";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/codelit/dialog";
import { Label } from "@/components/ui/codelit/label";
import {
  createSequence,
  type DeliverySourceSelection,
  listSendingOptions,
  listSystemTemplates,
  listTemplates,
  type SendingOption,
  type SystemTemplate,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import {
  MARKETING_EMAIL_EDITOR_BLOCKS,
  marketingPreviewContext,
} from "./email-editor-screen";

const MARKETING_PREVIEW_CONTEXT = marketingPreviewContext();

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
  const [sendingOptions, setSendingOptions] = useState<SendingOption[]>([]);
  const [deliverySource, setDeliverySource] = useState<DeliverySourceSelection | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDeliverySource(null);
    setLoading(true);
    Promise.all([
      listSystemTemplates("marketing"),
      listTemplates("marketing"),
      listSendingOptions(),
    ])
      .then(([system, own, sendingOptionsResult]) => {
        setSystemTemplates(system);
        setTemplates(own);
        setSendingOptions(sendingOptionsResult.items);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load templates"),
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
        deliverySource: deliverySource ?? undefined,
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
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:!max-w-5xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {error && <Banner>{error}</Banner>}
        <div className="space-y-1.5">
          <Label>Send via</Label>
          <DeliverySourcePicker
            options={sendingOptions}
            value={deliverySource}
            onChange={setDeliverySource}
            disabled={submitting || loading}
          />
        </div>
        <TemplateChooser
          className="mt-8"
          purpose="marketing"
          systemTemplates={systemTemplates}
          templates={templates}
          onSelect={onSelect}
          loading={loading || submitting}
          previewBlocks={MARKETING_EMAIL_EDITOR_BLOCKS}
          previewRenderContext={MARKETING_PREVIEW_CONTEXT}
        />
      </DialogContent>
    </Dialog>
  );
}
