"use client";

import type { SequenceSchedule } from "@sendlit/api-contract";
import {
  type Email,
  type EmailActionType,
  EmailPreview,
  type EmailTemplate,
  type ReentryMode,
  type Sequence,
  SequenceAnalytics,
  type SequenceEmail,
  SequenceEmailList,
  type SequenceStats,
  sequenceStatsMetrics,
  TagEditor,
} from "@sendlit/email-blocks";
import { Check, Pause, Pencil, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { AutoPauseBanner } from "@/components/dashboard/auto-pause-banner";
import { Banner } from "@/components/dashboard/banner";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { DeleteSequenceDialog } from "@/components/dashboard/delete-sequence-dialog";
import { DeliverySourcePicker } from "@/components/dashboard/delivery-source-picker";
import {
  EmailMoreMenu,
  PublishAllChangesActions,
  UnpublishedChangesStrip,
} from "@/components/dashboard/draft-controls";
import {
  MARKETING_EMAIL_EDITOR_BLOCKS,
  marketingPreviewContext,
} from "@/components/dashboard/email-editor-screen";
import { Loading } from "@/components/dashboard/loading";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { SendErrorMessage } from "@/components/dashboard/send-error-message";
import { SequenceTrigger } from "@/components/dashboard/sequence-trigger";
import { ViewInBrowserSetting } from "@/components/dashboard/view-in-browser-setting";
import { WaitingContactsDialog } from "@/components/dashboard/waiting-contacts-dialog";
import { Badge } from "@/components/ui/badge";
import { Button as LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  addSequenceEmail,
  type DeliverySourceSelection,
  deleteSequenceEmail,
  getSequence,
  getSequenceSchedule,
  getSequenceStats,
  listSendingOptions,
  listSystemTemplates,
  listTemplates,
  pauseSequence,
  type SendingOption,
  type SystemTemplate,
  startSequence,
  updateSequence,
  updateSequenceEmail,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import {
  isDeletedDeliverySource,
  presentDeliverySourceError,
} from "@/lib/delivery-source";

interface SequenceMeta {
  title: string;
  triggerType?: string | null;
  triggerData?: string | null;
  triggerFilter?: Sequence["triggerFilter"];
  reentry: ReentryMode;
  reentryPeriodDays?: number | null;
  deliverySource?: DeliverySourceSelection | null;
}

const MILLIS_IN_DAY = 86400000;

interface EmailDraft {
  subject: string;
  content: Email;
  delayInMillis: number;
  published: boolean;
  actionType?: EmailActionType | null;
  actionData?: Record<string, unknown> | null;
}

const STATUS_VARIANT: Record<Sequence["status"], "success" | "secondary" | "outline"> =
  {
    active: "success",
    draft: "secondary",
    paused: "outline",
    completed: "outline",
  };

/** What the step editor edits: the working copy, i.e. the unpublished
 * changes when there are some. */
function editableEmail(email: SequenceEmail): EmailDraft {
  return {
    subject: email.draft?.subject ?? email.subject,
    content: email.draft?.content ?? email.content,
    delayInMillis: email.delayInMillis,
    published: email.published,
    actionType: email.actionType,
    actionData: email.actionData,
  };
}

export default function SequenceEditorPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>;
}) {
  const { sequenceId } = use(params);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [meta, setMeta] = useState<SequenceMeta | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [stats, setStats] = useState<SequenceStats | null>(null);
  const [schedule, setSchedule] = useState<SequenceSchedule | null>(null);
  const [waitingEmailId, setWaitingEmailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sendingOptions, setSendingOptions] = useState<SendingOption[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  useSetBreadcrumb([
    { label: "Sequences", href: "/sequences" },
    { label: sequence?.title || "Untitled sequence" },
  ]);

  async function load(selectId?: string) {
    try {
      const s = await getSequence(sequenceId);
      setSequence(s);
      setMeta({
        title: s.title,
        triggerType: s.triggerType,
        triggerData: s.triggerData,
        triggerFilter: s.triggerFilter ?? null,
        reentry: s.reentry ?? "every_time",
        reentryPeriodDays: s.reentryPeriodDays ?? null,
        deliverySource: s.deliverySource,
      });
      const nextSelected =
        s.emails.find((e) => e.emailId === (selectId ?? selectedEmailId))?.emailId ??
        s.emailsOrder[0];
      selectEmail(s, nextSelected);
      if (s.status !== "draft") {
        setStats(await getSequenceStats(sequenceId));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load sequence");
    }
  }

  function selectEmail(s: Sequence, emailId?: string) {
    setSelectedEmailId(emailId ?? null);
    const found = s.emails.find((e) => e.emailId === emailId);
    setEmailDraft(found ? editableEmail(found) : null);
  }

  // Who waits for which email depends on the order and what's published, so
  // refetch whenever the sequence changes (reorder, publish, add, delete).
  useEffect(() => {
    if (!sequence || sequence.status === "draft") {
      setSchedule(null);
      return;
    }
    let cancelled = false;
    getSequenceSchedule(sequenceId)
      .then((next) => !cancelled && setSchedule(next))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sequenceId, sequence]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated every render; reload only when sequenceId changes
  useEffect(() => {
    load();
  }, [sequenceId]);

  useEffect(() => {
    setTemplatesLoading(true);
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
      .finally(() => setTemplatesLoading(false));
  }, []);

  // The API only accepts an ESP change while draft/paused (an active
  // sequence has already pinned and started sending through its ESP).
  const espEditable = sequence?.status === "draft" || sequence?.status === "paused";

  async function saveMeta() {
    if (!meta) return;
    setSavingMeta(true);
    setError(null);
    try {
      const updated = await updateSequence(sequenceId, {
        title: meta.title,
        triggerType: meta.triggerType || undefined,
        // An empty value is sent too, so a trigger value can be cleared.
        triggerData: meta.triggerData ?? undefined,
        triggerFilter: meta.triggerFilter ?? null,
        reentry: meta.reentry,
        reentryPeriodDays:
          meta.reentry === "once_per_period" ? (meta.reentryPeriodDays ?? 7) : null,
        ...(espEditable ? { deliverySource: meta.deliverySource ?? null } : {}),
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
      // Content is edited on its own full-screen editor route, so this
      // metadata save must not overwrite it.
      const patch: Parameters<typeof updateSequenceEmail>[2] = {
        subject: emailDraft.subject,
        delayInMillis: emailDraft.delayInMillis,
        published: emailDraft.published,
      };
      if (emailDraft.actionType) {
        patch.actionType = emailDraft.actionType;
        patch.actionData = emailDraft.actionData ?? undefined;
      }
      const updated = await updateSequenceEmail(sequenceId, selectedEmailId, patch);
      setSequence(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save email");
    } finally {
      setSavingEmail(false);
    }
  }

  /** A publish, discard or restore changed the emails' working copies. */
  function onDraftsChanged(updated: Sequence) {
    setSequence(updated);
    selectEmail(updated, selectedEmailId ?? undefined);
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
      setError(
        err instanceof ApiError
          ? presentDeliverySourceError(err.message)
          : "Action failed",
      );
    }
  }

  async function handleDelete(emailId: string) {
    try {
      const updated = await deleteSequenceEmail(sequenceId, emailId);
      setSequence(updated);
      selectEmail(updated, updated.emailsOrder[0]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete email");
    }
  }

  async function handleReorder(newEmailsOrder: string[]) {
    try {
      const updated = await updateSequence(sequenceId, {
        emailsOrder: newEmailsOrder,
      });
      setSequence(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reorder emails");
    }
  }

  if (error && !sequence)
    return (
      <Banner>
        <SendErrorMessage error={error} />
      </Banner>
    );
  if (!sequence || !meta) return <Loading />;

  const selectedEmail = sequence.emails.find((e) => e.emailId === selectedEmailId);
  // Save covers the fields above the content, which is edited on its own page.
  const emailChanged =
    selectedEmail !== undefined &&
    emailDraft !== null &&
    JSON.stringify({ ...editableEmail(selectedEmail), content: null }) !==
      JSON.stringify({ ...emailDraft, content: null });

  return (
    <ScrollablePage>
      <div className="w-full">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {sequence.title || "Untitled sequence"}
            </h1>
            <Badge variant={STATUS_VARIANT[sequence.status]}>{sequence.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PublishAllChangesActions sequence={sequence} onChange={onDraftsChanged} />
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              disabled={sequence.status === "active"}
              title={
                sequence.status === "active"
                  ? "Pause the sequence before deleting it."
                  : undefined
              }
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
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
        </div>

        <WaitingContactsDialog
          sequenceId={sequenceId}
          email={(() => {
            const email = sequence.emails.find((e) => e.emailId === waitingEmailId);
            return email
              ? {
                  emailId: email.emailId,
                  subject: email.subject,
                  delayInMillis: email.delayInMillis,
                  first:
                    sequence.emailsOrder.find((id) =>
                      sequence.emails.some((e) => e.emailId === id && e.published),
                    ) === email.emailId,
                }
              : null;
          })()}
          onOpenChange={(open) => !open && setWaitingEmailId(null)}
        />
        <DeleteSequenceDialog
          sequence={deleteOpen ? sequence : null}
          onOpenChange={setDeleteOpen}
          onDeleted={() => router.push("/sequences")}
        />

        {error && (
          <Banner className="mb-4">
            <SendErrorMessage error={error} />
          </Banner>
        )}

        {sequence.status === "paused" && (
          <AutoPauseBanner report={sequence.report} onResume={toggleStatus} />
        )}

        {stats && (
          <SequenceAnalytics
            className="mb-6"
            metrics={sequenceStatsMetrics(stats, schedule?.waiting)}
            onRefresh={async () => setStats(await getSequenceStats(sequenceId))}
          />
        )}

        <div className="mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
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
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sequence-title">Title</Label>
                <Input
                  id="sequence-title"
                  value={meta.title}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      title: e.target.value,
                    })
                  }
                  placeholder="e.g. Onboarding drip"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Delivery source</Label>
                <DeliverySourcePicker
                  options={sendingOptions}
                  value={meta.deliverySource}
                  onChange={(deliverySource) =>
                    setMeta({
                      ...meta,
                      deliverySource,
                    })
                  }
                  disabled={!espEditable}
                  deleted={isDeletedDeliverySource({
                    report: sequence?.report,
                    status: sequence?.status ?? "",
                    deliverySource: meta.deliverySource,
                  })}
                />
              </div>
              <SequenceTrigger
                meta={meta}
                onChange={(patch) => setMeta({ ...meta, ...patch })}
              />
              <ViewInBrowserSetting sequence={sequence} onSaved={setSequence} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Emails</h2>
            <SequenceEmailList
              emails={sequence.emails}
              emailsOrder={sequence.emailsOrder}
              selectedEmailId={selectedEmailId ?? undefined}
              // Not "Published"/"Draft": those name a step's unpublished
              // changes; this is whether contacts get the step at all.
              publishedLabel="Active"
              draftLabel="Skipped"
              onSelect={(emailId) => selectEmail(sequence, emailId)}
              onAdd={async (templateId) => {
                const updated = await addSequenceEmail(sequenceId, templateId);
                setSequence(updated);
                selectEmail(
                  updated,
                  updated.emailsOrder[updated.emailsOrder.length - 1],
                );
              }}
              onDelete={handleDelete}
              onReorder={handleReorder}
              renderEmailDetail={(email) => {
                const waiting =
                  schedule?.emails.find((e) => e.emailId === email.emailId)?.waiting ??
                  0;
                const unpublished = email.draft ? (
                  <span className="font-medium text-[var(--warning)]">
                    Unpublished changes
                  </span>
                ) : null;
                if (!waiting) return unpublished;
                // One line each: the list truncates a single line to its
                // narrow column, which would hide the waiting link.
                return (
                  <span className="flex flex-col items-start whitespace-normal">
                    {unpublished}
                    <LinkButton
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setWaitingEmailId(email.emailId);
                      }}
                    >
                      {waiting.toLocaleString()} waiting
                    </LinkButton>
                  </span>
                );
              }}
              systemTemplates={systemTemplates}
              templates={templates}
              templatesLoading={templatesLoading}
              previewBlocks={MARKETING_EMAIL_EDITOR_BLOCKS}
              previewRenderContext={marketingPreviewContext({
                viewInBrowser: sequence.viewInBrowser,
              })}
            />
          </div>

          <div>
            {emailDraft ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Edit email</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-subject">Subject</Label>
                    <Input
                      id="email-subject"
                      value={emailDraft.subject}
                      onChange={(e) =>
                        setEmailDraft({
                          ...emailDraft,
                          subject: e.target.value,
                        })
                      }
                      placeholder="Your subject line"
                    />
                    {selectedEmail?.draft &&
                      selectedEmail.draft.subject !== selectedEmail.subject && (
                        <p className="text-xs text-muted-foreground">
                          Published subject: {selectedEmail.subject || "—"}
                        </p>
                      )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="email-delay">Send after (days)</Label>
                      <Input
                        id="email-delay"
                        type="number"
                        min={0}
                        value={emailDraft.delayInMillis / MILLIS_IN_DAY}
                        onChange={(e) =>
                          setEmailDraft({
                            ...emailDraft,
                            delayInMillis: Number(e.target.value || 0) * MILLIS_IN_DAY,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>On send, tag contact</Label>
                      <Select
                        value={emailDraft.actionType ?? "none"}
                        onValueChange={(actionType) =>
                          setEmailDraft({
                            ...emailDraft,
                            actionType:
                              actionType === "none"
                                ? null
                                : (actionType as EmailActionType),
                          })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No action</SelectItem>
                          <SelectItem value="tag:add">Add tag</SelectItem>
                          <SelectItem value="tag:remove">Remove tag</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {emailDraft.actionType && (
                      <div className="space-y-1.5">
                        <Label>Tag name</Label>
                        <TagEditor
                          aria-label="Tag name"
                          tags={
                            (emailDraft.actionData?.tag as string)
                              ? [emailDraft.actionData?.tag as string]
                              : []
                          }
                          onAdd={(tag) =>
                            setEmailDraft({
                              ...emailDraft,
                              actionData: {
                                tag,
                              },
                            })
                          }
                          onRemove={() =>
                            setEmailDraft({
                              ...emailDraft,
                              actionData: null,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="email-published"
                        checked={emailDraft.published}
                        onCheckedChange={(published) =>
                          setEmailDraft({
                            ...emailDraft,
                            published,
                          })
                        }
                      />
                      <Label
                        htmlFor="email-published"
                        className="flex flex-col items-start gap-0.5"
                      >
                        <span>Send this email</span>
                        <span className="font-normal text-muted-foreground">
                          {emailDraft.published
                            ? "Contacts get this email at this step."
                            : "Contacts skip this email."}
                        </span>
                      </Label>
                    </div>
                    {/* Green only when there's something to save, so it doesn't
                        compete with Publish. */}
                    <Button
                      size="sm"
                      variant={emailChanged ? "primary" : "outline"}
                      onClick={saveEmail}
                      disabled={savingEmail || !emailChanged}
                    >
                      <Check className="size-4" />
                      {savingEmail ? "Saving…" : "Save"}
                    </Button>
                  </div>

                  <div className="space-y-1.5 border-t pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Content</Label>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/editor/sequences/${sequenceId}/emails/${selectedEmailId}`}
                          >
                            <Pencil className="size-4" />
                            Edit content
                          </Link>
                        </Button>
                        {selectedEmailId && (
                          <EmailMoreMenu
                            sequence={sequence}
                            emailId={selectedEmailId}
                            onChange={onDraftsChanged}
                          />
                        )}
                      </div>
                    </div>
                    {selectedEmailId && (
                      <UnpublishedChangesStrip
                        sequence={sequence}
                        emailIds={[selectedEmailId]}
                        onChange={onDraftsChanged}
                      />
                    )}
                    <EmailPreview
                      content={emailDraft.content}
                      minHeight="420px"
                      blocks={MARKETING_EMAIL_EDITOR_BLOCKS}
                      renderContext={marketingPreviewContext({
                        viewInBrowser: sequence.viewInBrowser,
                      })}
                    />
                  </div>
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
