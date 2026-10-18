// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    resetPosthogUser: vi.fn(),
    useSidebar: vi.fn(() => ({ isMobile: false })),
}));

vi.mock("@/lib/posthog-browser", () => ({
    resetPosthogUser: mocks.resetPosthogUser,
}));

vi.mock("@/components/ui/sidebar", () => ({
    SidebarMenu: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
        <button type="button">{children}</button>
    ),
    useSidebar: mocks.useSidebar,
}));

vi.mock("@/components/ui/codelit/dropdown-menu", () => ({
    DropdownMenu: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
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

import { NavUser } from "./nav-user";

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
