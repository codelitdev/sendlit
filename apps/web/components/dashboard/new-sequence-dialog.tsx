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
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/dashboard/banner";
import { EspPicker } from "@/components/dashboard/esp-picker";
import { ApiError } from "@/lib/api-client";
import {
    createSequence,
    listEsps,
    listSystemTemplates,
    listTemplates,
    type EspConfig,
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
    const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>(
        [],
    );
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [esps, setEsps] = useState<EspConfig[]>([]);
    const [espId, setEspId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setEspId(null);
        setLoading(true);
        Promise.all([listSystemTemplates(), listTemplates(), listEsps()])
            .then(([system, own, espResult]) => {
                setSystemTemplates(system);
                setTemplates(own);
                setEsps(espResult.items);
            })
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load templates",
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
                espId: espId ?? undefined,
            });
            setOpen(false);
            onCreated(sequence.sequenceId);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to create",
            );
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
                {esps.length > 1 && (
                    <div className="space-y-1.5">
                        <Label>Send via</Label>
                        <EspPicker
                            esps={esps}
                            value={espId}
                            onChange={setEspId}
                            disabled={submitting}
                        />
                    </div>
                )}
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
