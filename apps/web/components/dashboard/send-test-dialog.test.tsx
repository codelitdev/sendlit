import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const getGeneralSettings = mock(async () => ({ mailingAddress: "1 Main St" }));
const updateGeneralSettings = mock(async (input: { mailingAddress?: string }) => ({
  mailingAddress: input.mailingAddress ?? null,
}));
const sendSequenceEmailTest = mock(async (_s: string, _e: string, to: string[]) => ({
  sent: to,
  skipped: [] as { email: string }[],
  lastTestSentAt: "2026-10-22T10:00:00.000Z",
}));

mock.module("@/lib/api", () => ({
  getGeneralSettings,
  updateGeneralSettings,
  sendSequenceEmailTest,
}));
mock.module("sonner", () => ({ toast: { success: mock(), warning: mock() } }));

const { act, cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);
const { addRecipients, parseRecipients, SendTestDialog } = await import(
  "./send-test-dialog"
);

const mailpit = {
  type: "team" as const,
  espId: "esp_1",
  name: "Mailpit QA",
  fromName: null,
  fromEmail: "no-reply@predator.local",
  isDefault: true,
  available: true,
  countsAgainstQuota: false as const,
};

function openDialog() {
  render(
    <SendTestDialog
      sequenceId="seq_1"
      emailId="email_1"
      subject="October news"
      sendingVia={mailpit}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
}

/** The dialog's own Send test button (the trigger is hidden while it's open). */
function sendButton() {
  return screen
    .getAllByRole("button", { name: "Send test" })
    .at(-1) as HTMLButtonElement;
}

/** Lets pending API mocks resolve and React re-render. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function addAddress(email: string) {
  const input = screen.getByLabelText("Send to");
  fireEvent.change(input, { target: { value: email } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("recipient helpers", () => {
  it("splits on commas, semicolons and spaces", () => {
    expect(parseRecipients("a@x.com, b@x.com;c@x.com  d@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
  });

  it("stops at five addresses", () => {
    expect(
      addRecipients(
        ["a@x.com"],
        ["b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"],
      ),
    ).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
  });

  it("skips duplicates regardless of case", () => {
    expect(addRecipients(["a@x.com"], ["A@x.com", "b@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });
});

describe("SendTestDialog", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async () => Response.json(null)) as never;
    getGeneralSettings.mockImplementation(async () => ({
      mailingAddress: "1 Main St",
    }));
    sendSequenceEmailTest.mockClear();
  });
  afterEach(cleanup);

  it("shows from, delivery source and the [Test] subject", async () => {
    openDialog();
    await settle();
    expect(screen.getByText("no-reply@predator.local")).toBeTruthy();
    expect(screen.getByText("Mailpit QA")).toBeTruthy();
    expect(screen.getByText("Same as the real email")).toBeTruthy();
    expect(screen.getByText("[Test]")).toBeTruthy();
    expect(screen.getByText("October news")).toBeTruthy();
  });

  it("adds addresses as chips and sends to them", async () => {
    openDialog();
    await settle();
    addAddress("one@example.com");
    addAddress("two@example.com");
    expect(screen.getByText("2 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove one@example.com" }));
    expect(screen.getByText("1 of 5")).toBeTruthy();
    await settle();
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    await settle();
    expect(sendSequenceEmailTest).toHaveBeenCalledWith("seq_1", "email_1", [
      "two@example.com",
    ]);
  });

  it("hides the address input once five are added", async () => {
    openDialog();
    await settle();
    for (const n of [1, 2, 3, 4, 5]) addAddress(`p${n}@example.com`);
    expect(screen.getByText("5 of 5")).toBeTruthy();
    expect(screen.getByText(/at most 5 addresses/)).toBeTruthy();
    expect(
      (document.getElementById("send-test-recipients") as HTMLInputElement).hidden,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove p1@example.com" }));
    expect(screen.getByText("4 of 5")).toBeTruthy();
    expect(screen.queryByText(/at most 5 addresses/)).toBeNull();
  });

  it("asks for the mailing address before sending, and saves it inline", async () => {
    getGeneralSettings.mockImplementation(async () => ({ mailingAddress: "" }));
    openDialog();
    await settle();
    expect(screen.getByText("Add your mailing address first")).toBeTruthy();
    expect(screen.getByText("Add your mailing address to send")).toBeTruthy();
    expect(sendButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add mailing address" }));
    fireEvent.change(screen.getByLabelText("Mailing address"), {
      target: { value: "1 Main St, Pune" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await settle();
    expect(screen.queryByText("Add your mailing address first")).toBeNull();
    expect(updateGeneralSettings).toHaveBeenCalledWith({
      mailingAddress: "1 Main St, Pune",
    });
    expect(sendButton().disabled).toBe(false);
  });
});
