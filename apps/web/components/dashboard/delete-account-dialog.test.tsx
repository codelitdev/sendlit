import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

type Preview = {
  email: string;
  blocked: boolean;
  organizations: Array<{
    organizationId: string;
    name: string;
    status: "active" | "closed";
    role: "owner" | "admin" | "member";
    action: "delete" | "leave";
    teamCount: number;
    blocker: null | "active_subscription_exists" | "last_organization_owner";
  }>;
};

let preview: Preview;
const getAccountDeletion = mock(async () => preview);
const sendAccountDeletionCode = mock(async () => undefined);
const deleteAccount = mock(async (_email: string, _code: string) => undefined);

mock.module("@/lib/api", () => ({
  getAccountDeletion,
  sendAccountDeletionCode,
  deleteAccount,
}));

const { act, cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);
const { DeleteAccountDialog } = await import("./delete-account-dialog");

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deleteButton() {
  return screen.getByRole("button", { name: "Delete account" }) as HTMLButtonElement;
}

beforeEach(() => {
  preview = {
    email: "ada@example.com",
    blocked: false,
    organizations: [
      {
        organizationId: "org_solo",
        name: "Solo",
        status: "active",
        role: "owner",
        action: "delete",
        teamCount: 2,
        blocker: null,
      },
      {
        organizationId: "org_shared",
        name: "Shared",
        status: "active",
        role: "owner",
        action: "leave",
        teamCount: 1,
        blocker: null,
      },
    ],
  };
  getAccountDeletion.mockClear();
  sendAccountDeletionCode.mockClear();
  deleteAccount.mockClear();
});
afterEach(cleanup);

describe("DeleteAccountDialog", () => {
  it("lists each organization's fate and deletes after the email and code", async () => {
    const onDeleted = mock();
    render(<DeleteAccountDialog open onOpenChange={mock()} onDeleted={onDeleted} />);
    await settle();

    expect(screen.getByText("2 of 2 organizations ready")).toBeTruthy();
    expect(
      screen.getByText("Deleted with its 2 teams, contacts and media."),
    ).toBeTruthy();
    expect(screen.getByText("You'll leave")).toBeTruthy();
    expect(deleteButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await settle();
    expect(sendAccountDeletionCode).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Code from your email"), {
      target: { value: "123456" },
    });
    expect(deleteButton().disabled).toBe(false);
    fireEvent.click(deleteButton());
    await settle();

    expect(deleteAccount).toHaveBeenCalledWith("ada@example.com", "123456");
    expect(onDeleted).toHaveBeenCalled();
  });

  it("opens blocked organizations and keeps the delete disabled", async () => {
    preview.blocked = true;
    preview.organizations[0].blocker = "active_subscription_exists";
    render(<DeleteAccountDialog open onOpenChange={mock()} onDeleted={mock()} />);
    await settle();

    expect(screen.getByText("1 of 2 organizations ready")).toBeTruthy();
    expect(screen.getByText("Solo needs attention")).toBeTruthy();
    expect(screen.getByText("Cancel billing first")).toBeTruthy();
    expect(screen.getByText(/Cancel this organization's subscription/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Manage billing/ })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send code" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(deleteButton().disabled).toBe(true);
  });
});
