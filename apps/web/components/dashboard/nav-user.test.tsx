import { afterEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";
import type React from "react";

registerDom();

const mocks = {
  resetPosthogUser: mock(),
  useSidebar: mock(() => ({ isMobile: false })),
};

mock.module("@/lib/posthog-browser", () => ({
  resetPosthogUser: mocks.resetPosthogUser,
}));

mock.module("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  useSidebar: mocks.useSidebar,
}));

mock.module("@/components/ui/codelit/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { NavUser } = await import("./nav-user");

describe("NavUser", () => {
  afterEach(() => {
    cleanup();
    mocks.resetPosthogUser.mockReset();
  });

  it("resets PostHog identity when signing out", () => {
    render(<NavUser user={{ email: "ada@example.com", name: "Ada" }} />);

    const form = document.querySelector(
      'form[action="/api/auth/sign-out"]',
    ) as HTMLFormElement;
    expect(form).toBeTruthy();
    fireEvent.submit(form);
    expect(mocks.resetPosthogUser).toHaveBeenCalledTimes(1);
  });
});
