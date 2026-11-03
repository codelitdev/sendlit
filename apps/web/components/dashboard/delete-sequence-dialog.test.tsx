import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const getSequenceDeletionPreview = mock(async (_sequenceId: string) => ({
  status: "paused",
  blocker: null as "sequence_active" | "broadcast_sent" | null,
  enrolledCount: 3,
  emailsSentCount: 12,
}));
const deleteSequence = mock(async (_sequenceId: string) => undefined);

mock.module("@/lib/api", () => ({ getSequenceDeletionPreview, deleteSequence }));

const { act, cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);
const { DeleteSequenceDialog } = await import("./delete-sequence-dialog");

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function confirmButton() {
  return screen.getByRole("button", { name: "Delete sequence" }) as HTMLButtonElement;
}

beforeEach(() => {
  getSequenceDeletionPreview.mockClear();
  deleteSequence.mockClear();
});
afterEach(cleanup);

describe("DeleteSequenceDialog", () => {
  it("says how many contacts are enrolled and that stats are lost, then deletes", async () => {
    const onDeleted = mock();
    const onOpenChange = mock();
    render(
      <DeleteSequenceDialog
        sequence={{ sequenceId: "seq_1", title: "Onboarding" }}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );
    await settle();

    expect(getSequenceDeletionPreview).toHaveBeenCalledWith("seq_1");
    expect(screen.getByText('Delete "Onboarding"?')).toBeTruthy();
    expect(screen.getByText(/3 contacts are\s+enrolled/)).toBeTruthy();
    expect(screen.getByText(/Stats for 12 sent emails/)).toBeTruthy();

    fireEvent.click(confirmButton());
    await settle();

    expect(deleteSequence).toHaveBeenCalledWith("seq_1");
    expect(onDeleted).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses to delete an active sequence and says to pause it", async () => {
    getSequenceDeletionPreview.mockResolvedValueOnce({
      status: "active",
      blocker: "sequence_active",
      enrolledCount: 1,
      emailsSentCount: 1,
    });
    render(
      <DeleteSequenceDialog
        sequence={{ sequenceId: "seq_2", title: "" }}
        onOpenChange={mock()}
        onDeleted={mock()}
      />,
    );
    await settle();

    expect(screen.getByText(/Pause it before deleting it/)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    expect(deleteSequence).not.toHaveBeenCalled();
  });

  it("refuses to delete a sent broadcast and offers to archive it", async () => {
    getSequenceDeletionPreview.mockResolvedValueOnce({
      status: "completed",
      blocker: "broadcast_sent",
      enrolledCount: 0,
      emailsSentCount: 40,
    });
    const onArchiveInstead = mock();
    render(
      <DeleteSequenceDialog
        type="broadcast"
        sequence={{ sequenceId: "seq_3", title: "October news" }}
        onOpenChange={mock()}
        onDeleted={mock()}
        onArchiveInstead={onArchiveInstead}
      />,
    );
    await settle();

    expect(screen.getByText(/its report would be lost/)).toBeTruthy();
    const confirm = screen.getByRole("button", {
      name: "Delete broadcast",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    expect(onArchiveInstead).toHaveBeenCalled();
    expect(deleteSequence).not.toHaveBeenCalled();
  });

  it("deletes a scheduled broadcast and says its send is cancelled", async () => {
    getSequenceDeletionPreview.mockResolvedValueOnce({
      status: "active",
      blocker: null,
      enrolledCount: 0,
      emailsSentCount: 0,
    });
    const onDeleted = mock();
    render(
      <DeleteSequenceDialog
        type="broadcast"
        sequence={{ sequenceId: "seq_4", title: "Launch" }}
        onOpenChange={mock()}
        onDeleted={onDeleted}
      />,
    );
    await settle();

    expect(screen.getByText(/scheduled send is cancelled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete broadcast" }));
    await settle();
    expect(deleteSequence).toHaveBeenCalledWith("seq_4");
    expect(onDeleted).toHaveBeenCalled();
  });
});
