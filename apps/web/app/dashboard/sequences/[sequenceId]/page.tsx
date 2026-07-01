"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
  addSequenceEmail,
  deleteSequenceEmail,
  getSequence,
  getSequenceStats,
  listSystemTemplates,
  listTemplates,
  pauseSequence,
  startSequence,
  updateSequence,
  updateSequenceEmail,
  type SystemTemplate,
} from "@/lib/api";
import {
  SequenceEmailForm,
  SequenceEmailList,
  SequenceMetaForm,
  TemplateChooser,
  type EmailTemplate,
  type Sequence,
  type SequenceEmailFormValue,
  type SequenceMetaFormValue,
  type SequenceStats,
} from "@sendlit/email-blocks";

const STATUS_VARIANT: Record<
  Sequence["status"],
  "success" | "secondary" | "outline"
> = {
  active: "success",
  draft: "secondary",
  paused: "outline",
  completed: "outline",
};

export default function SequenceEditorPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>;
}) {
  const { sequenceId } = use(params);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [meta, setMeta] = useState<SequenceMetaFormValue | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<SequenceEmailFormValue | null>(
    null,
  );
  const [stats, setStats] = useState<SequenceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [addEmailOpen, setAddEmailOpen] = useState(false);

  async function load(selectId?: string) {
    try {
      const s = await getSequence(sequenceId);
      setSequence(s);
      setMeta({
        title: s.title,
        fromName: s.fromName,
        fromEmail: s.fromEmail,
        triggerType: s.triggerType,
        triggerData: s.triggerData,
      });
      const nextSelected =
        s.emails.find((e) => e.emailId === (selectId ?? selectedEmailId))
          ?.emailId ?? s.emailsOrder[0];
      selectEmail(s, nextSelected);
      if (s.status !== "draft") {
        setStats(await getSequenceStats(sequenceId));
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load sequence",
      );
    }
  }

  function selectEmail(s: Sequence, emailId?: string) {
    setSelectedEmailId(emailId ?? null);
    const found = s.emails.find((e) => e.emailId === emailId);
    setEmailDraft(
      found
        ? {
            subject: found.subject,
            content: found.content,
            delayInMillis: found.delayInMillis,
            published: found.published,
            actionType: found.actionType,
            actionData: found.actionData,
          }
        : null,
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceId]);

  async function saveMeta() {
    if (!meta) return;
    setSavingMeta(true);
    setError(null);
    try {
      const updated = await updateSequence(sequenceId, {
        title: meta.title,
        fromName: meta.fromName || undefined,
        fromEmail: meta.fromEmail || undefined,
        triggerType: meta.triggerType || undefined,
        triggerData: meta.triggerData || undefined,
      });
      setSequence(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSavingMeta(false);
    }
  }

  async function saveEmail() {
    if (!selectedEmailId || !emailDraft) return;
    setSavingEmail(true);
    setError(null);
    try {
      const patch: Parameters<typeof updateSequenceEmail>[2] = {
        subject: emailDraft.subject,
        content: emailDraft.content,
        delayInMillis: emailDraft.delayInMillis,
        published: emailDraft.published,
      };
      if (emailDraft.actionType) {
        patch.actionType = emailDraft.actionType;
        patch.actionData = emailDraft.actionData ?? undefined;
      }
      const updated = await updateSequenceEmail(
        sequenceId,
        selectedEmailId,
        patch,
      );
      setSequence(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save email");
    } finally {
      setSavingEmail(false);
    }
  }

  async function toggleStatus() {
    if (!sequence) return;
    setError(null);
    try {
      const updated =
        sequence.status === "active"
          ? await pauseSequence(sequenceId)
          : await startSequence(sequenceId);
      setSequence(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  async function handleDelete(emailId: string) {
    try {
      const updated = await deleteSequenceEmail(sequenceId, emailId);
      setSequence(updated);
      selectEmail(updated, updated.emailsOrder[0]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete email",
      );
    }
  }

  async function handleReorder(newEmailsOrder: string[]) {
    try {
      const updated = await updateSequence(sequenceId, {
        emailsOrder: newEmailsOrder,
      });
      setSequence(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to reorder emails",
      );
    }
  }

  if (error && !sequence) return <Banner>{error}</Banner>;
  if (!sequence || !meta)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <ScrollablePage>
    <div className="max-w-5xl">
      <Link
        href="/dashboard/sequences"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to sequences
      </Link>

      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {sequence.title || "Untitled sequence"}
          </h1>
          <Badge variant={STATUS_VARIANT[sequence.status]}>
            {sequence.status}
          </Badge>
        </div>
        {sequence.status !== "completed" && (
          <Button onClick={toggleStatus}>
            {sequence.status === "active" ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {sequence.status === "active" ? "Pause" : "Activate"}
          </Button>
        )}
      </div>

      {error && <Banner className="mb-4">{error}</Banner>}

      {stats && (
        <div className="mb-6 grid grid-cols-4 gap-4">
          <StatCard label="Sent" value={stats.sent} />
          <StatCard label="Recipients" value={stats.subscribersCount} />
          <StatCard
            label="Open rate"
            value={`${Math.round(stats.openRate * 100)}%`}
          />
          <StatCard
            label="Click rate"
            value={`${Math.round(stats.clickThroughRate * 100)}%`}
          />
        </div>
      )}

      <div className="mb-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Details &amp; trigger</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={saveMeta}
              disabled={savingMeta}
            >
              {savingMeta ? "Saving…" : "Save"}
            </Button>
          </CardHeader>
          <CardContent>
            <SequenceMetaForm type="sequence" value={meta} onChange={setMeta} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Emails
          </h2>
          <SequenceEmailList
            emails={sequence.emails}
            emailsOrder={sequence.emailsOrder}
            selectedEmailId={selectedEmailId ?? undefined}
            onSelect={(emailId) => selectEmail(sequence, emailId)}
            onAdd={() => setAddEmailOpen(true)}
            onDelete={handleDelete}
            onReorder={handleReorder}
          />
          <AddEmailDialog
            open={addEmailOpen}
            onOpenChange={setAddEmailOpen}
            onAdd={async (templateId) => {
              const updated = await addSequenceEmail(sequenceId, templateId);
              setSequence(updated);
              selectEmail(
                updated,
                updated.emailsOrder[updated.emailsOrder.length - 1],
              );
            }}
          />
        </div>

        <div>
          {emailDraft ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Edit email</CardTitle>
                <Button size="sm" onClick={saveEmail} disabled={savingEmail}>
                  {savingEmail ? (
                    "Saving…"
                  ) : (
                    <>
                      <Check className="size-4" />
                      Save
                    </>
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                <SequenceEmailForm
                  value={emailDraft}
                  onChange={setEmailDraft}
                  variant="sequence"
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Select or add an email to edit its content.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </ScrollablePage>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function AddEmailDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (templateId: string) => Promise<void>;
}) {
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    await onAdd(choice.templateId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add email</DialogTitle>
        </DialogHeader>
        {error && <Banner>{error}</Banner>}
        <TemplateChooser
          systemTemplates={systemTemplates}
          templates={templates}
          onSelect={onSelect}
          loading={loading}
        />
      </DialogContent>
    </Dialog>
  );
}
