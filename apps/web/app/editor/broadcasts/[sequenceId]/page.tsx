"use client";

import { use } from "react";
import { SequenceEmailEditor } from "@/components/dashboard/sequence-email-editor";

export default function BroadcastEmailEditorPage({
    params,
}: {
    params: Promise<{ sequenceId: string }>;
}) {
    const { sequenceId } = use(params);
    return (
        <SequenceEmailEditor
            sequenceId={sequenceId}
            exitFallbackHref={`/broadcasts/${sequenceId}`}
        />
    );
}
