import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const getSequenceDeletionPreview = mock(async (_sequenceId: string) => ({
  status: "paused",
  blocker: null as "sequence_active" | null,
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
});
