"use client";

import { use } from "react";
import { SequenceEmailEditor } from "@/components/dashboard/sequence-email-editor";

export default function SequenceEmailEditorPage({
    params,
}: {
    params: Promise<{ sequenceId: string; emailId: string }>;
}) {
    const { sequenceId, emailId } = use(params);
    return (
        <SequenceEmailEditor
            sequenceId={sequenceId}
            emailId={emailId}
            exitFallbackHref={`/dashboard/sequences/${sequenceId}`}
        />
    );
}
