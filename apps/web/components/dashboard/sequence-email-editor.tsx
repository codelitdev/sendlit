"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { EmailEditorScreen } from "@/components/dashboard/email-editor-screen";
import { ApiError } from "@/lib/api-client";
import { getSequence, updateSequenceEmail } from "@/lib/api";
import type { Email } from "@sendlit/email-blocks";

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
    }>();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getSequence(sequenceId)
            .then((sequence) => {
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
                });
            })
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load email",
                ),
            );
    }, [sequenceId, emailId]);

    if (error) return <Banner>{error}</Banner>;
    if (!email)
        return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <EmailEditorScreen
            exitFallbackHref={exitFallbackHref}
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
        />
    );
}
