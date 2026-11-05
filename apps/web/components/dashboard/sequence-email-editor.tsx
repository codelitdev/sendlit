"use client";

import type { Email, Sequence } from "@sendlit/email-blocks";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { UnpublishedChangesActions } from "@/components/dashboard/draft-controls";
import { EmailEditorScreen } from "@/components/dashboard/email-editor-screen";
import { Loading } from "@/components/dashboard/loading";
import { SendTestDialog } from "@/components/dashboard/send-test-dialog";
import {
  type DeliverySourceSelection,
  getEventDefinition,
  getSequence,
  listSendingOptions,
  type SendingOption,
  updateSequence,
  updateSequenceEmail,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { sendingOptionFor } from "@/lib/delivery-source";

/**
 * Loads one email of a sequence/broadcast and edits its content full-screen.
 * `emailId` is omitted for broadcasts, which have exactly one email.
 */
export function SequenceEmailEditor({
  sequenceId,
  emailId,
  exitFallbackHref,
}: {
  sequenceId: string;
  emailId?: string;
  exitFallbackHref: string;
}) {
  const [email, setEmail] = useState<{
    emailId: string;
    subject: string;
    content: Email;
    lastTestSentAt?: string | null;
  }>();
  const [error, setError] = useState<string | null>(null);
  const [sendingOptions, setSendingOptions] = useState<SendingOption[]>([]);
  const [deliverySource, setDeliverySource] = useState<DeliverySourceSelection | null>(
    null,
  );
  const [viewInBrowser, setViewInBrowser] = useState(true);
  // A broadcast's subject is its title; the API keeps the two in step.
  const [isBroadcast, setIsBroadcast] = useState(false);
  const [savedSubject, setSavedSubject] = useState("");
  // The latest saved state, for "Unpublished changes" and Publish.
  const [sequence, setSequence] = useState<Sequence>();
  const latestSequence = useRef<Sequence>(undefined);
  function sequenceSaved(updated: Sequence) {
    latestSequence.current = updated;
    setSequence(updated);
  }
  const [eventVariables, setEventVariables] = useState<
    { tag: string; description: string }[]
  >([]);

  useEffect(() => {
    // Which delivery source a test goes through; best effort.
    listSendingOptions()
      .then(({ items }) => setSendingOptions(items))
      .catch(() => undefined);
    getSequence(sequenceId)
      .then((sequence) => {
        latestSequence.current = sequence;
        setSequence(sequence);
        setDeliverySource(sequence.deliverySource ?? null);
        setViewInBrowser(sequence.viewInBrowser);
        setIsBroadcast(sequence.type === "broadcast");
        // `{{ event.* }}`: the properties of the event that starts it.
        if (sequence.triggerType === "event:custom" && sequence.triggerData) {
          const name = sequence.triggerData;
          getEventDefinition(name)
            .then((definition) =>
              setEventVariables(
                definition.properties.map((property) => ({
                  tag: `{{ event.${property.key} }}`,
                  description: `From the "${name}" event (${property.type}). Add | default: "…" for events without it.`,
                })),
              ),
            )
            .catch(() => undefined);
        }
        const found = emailId
          ? sequence.emails.find((e) => e.emailId === emailId)
          : sequence.emails[0];
        if (!found) {
          setError("Email not found");
          return;
        }
        // The working copy: unpublished changes when there are some.
        const subject = found.draft?.subject ?? found.subject;
        setSavedSubject(subject);
        setEmail({
          emailId: found.emailId,
          subject,
          content: found.draft?.content ?? found.content,
          lastTestSentAt: found.lastTestSentAt,
        });
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load email"),
      );
  }, [sequenceId, emailId]);

  if (error) return <Banner>{error}</Banner>;
  if (!email || !sequence) return <Loading />;

  return (
    <EmailEditorScreen
      exitFallbackHref={exitFallbackHref}
      purpose="marketing"
      viewInBrowser={viewInBrowser}
      extraVariables={eventVariables}
      subject={email.subject}
      onSubjectChange={(subject) => setEmail({ ...email, subject })}
      senderName={
        sendingOptionFor(sendingOptions, deliverySource)?.fromName ?? undefined
      }
      initialContent={email.content}
      // While it's active, saving doesn't change what contacts get.
      saveLabel={sequence.status === "active" ? "Save draft" : "Save"}
      otherChangesUnsaved={email.subject !== savedSubject}
      onSave={async (content) => {
        if (isBroadcast && email.subject !== savedSubject) {
          await updateSequence(sequenceId, { title: email.subject });
        }
        sequenceSaved(
          await updateSequenceEmail(sequenceId, email.emailId, {
            content,
            ...(isBroadcast ? {} : { subject: email.subject }),
          }),
        );
        setSavedSubject(email.subject);
      }}
      actions={(saveContent) => (
        <>
          <UnpublishedChangesActions
            sequence={sequence}
            emailIds={[email.emailId]}
            beforePublish={async () => {
              // Publish what's on screen.
              await saveContent();
              return latestSequence.current;
            }}
            onChange={sequenceSaved}
          />
          <SendTestDialog
            sendingVia={sendingOptionFor(sendingOptions, deliverySource)}
            subject={email.subject}
            sequenceId={sequenceId}
            emailId={email.emailId}
            lastTestSentAt={email.lastTestSentAt}
            beforeSend={saveContent}
            onSent={(lastTestSentAt) => setEmail({ ...email, lastTestSentAt })}
          />
        </>
      )}
    />
  );
}
