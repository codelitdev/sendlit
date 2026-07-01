import { SequenceListPage } from "@/components/dashboard/sequence-list";

export default function SequencesPage() {
    return (
        <SequenceListPage
            type="sequence"
            title="Sequences"
            description="Multi-step, event-triggered email automations."
            createLabel="New sequence"
            basePath="/dashboard/sequences"
        />
    );
}
