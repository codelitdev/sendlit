import { SequenceListPage } from "@/components/dashboard/sequence-list";

export default function BroadcastsPage() {
    return (
        <SequenceListPage
            type="broadcast"
            title="Broadcasts"
            description="One-off emails sent to a segment of your contacts."
            createLabel="New broadcast"
            basePath="/broadcasts"
        />
    );
}
