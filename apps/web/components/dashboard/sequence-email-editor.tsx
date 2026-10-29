"use client";

import type { Email } from "@sendlit/email-blocks";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { EmailEditorScreen } from "@/components/dashboard/email-editor-screen";
import { Loading } from "@/components/dashboard/loading";
import { SendTestDialog } from "@/components/dashboard/send-test-dialog";
import {
  type DeliverySourceSelection,
  getEventDefinition,
  getSequence,
  listSendingOptions,
  type SendingOption,
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
        setDeliverySource(sequence.deliverySource ?? null);
        setViewInBrowser(sequence.viewInBrowser);
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
        setEmail({
          emailId: found.emailId,
          subject: found.subject,
          content: found.content,
          lastTestSentAt: found.lastTestSentAt,
        });
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load email"),
      );
  }, [sequenceId, emailId]);

  if (error) return <Banner>{error}</Banner>;
  if (!email) return <Loading />;

  return (
    <EmailEditorScreen
      exitFallbackHref={exitFallbackHref}
      purpose="marketing"
      viewInBrowser={viewInBrowser}
      extraVariables={eventVariables}
      header={
        <h1 className="truncate text-base font-semibold">
          {email.subject || "Untitled email"}
        </h1>
      }
      initialContent={email.content}
      onSave={async (content) => {
        await updateSequenceEmail(sequenceId, email.emailId, {
          content,
        });
      }}
      actions={(saveContent) => (
        <SendTestDialog
          sendingVia={sendingOptionFor(sendingOptions, deliverySource)}
          subject={email.subject}
          sequenceId={sequenceId}
          emailId={email.emailId}
          lastTestSentAt={email.lastTestSentAt}
          beforeSend={saveContent}
          onSent={(lastTestSentAt) => setEmail({ ...email, lastTestSentAt })}
        />
      )}
    />
  );
}
