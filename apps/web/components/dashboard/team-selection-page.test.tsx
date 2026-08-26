// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BreadcrumbProvider } from "@/components/dashboard/breadcrumb-context";

const mocks = vi.hoisted(() => ({
    listTeams: vi.fn(),
    createTeam: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
    ApiError: class ApiError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    },
    listTeams: mocks.listTeams,
    createTeam: mocks.createTeam,
}));

vi.mock("@/lib/tokens", async () => {
    const actual =
        await vi.importActual<typeof import("@/lib/tokens")>("@/lib/tokens");
    return {
        ...actual,
        resolveCurrentTeamId: () => "team_current",
        selectOrganizationContext: vi.fn(),
    };
});

import { TeamSelectionPage } from "./team-selection-page";

describe("TeamSelectionPage", () => {
    beforeEach(() => {
        mocks.listTeams.mockResolvedValue({
            items: [
                {
                    teamId: "team_current",
                    organizationId: "org_a",
                    name: "Current team",
                },
                {
                    teamId: "team_other",
                    organizationId: "org_b",
                    name: "Other team",
                },
            ],
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("includes organization context on the switch form", async () => {
        render(
            <BreadcrumbProvider>
                <TeamSelectionPage />
            </BreadcrumbProvider>,
        );

        await waitFor(() => {
            expect(screen.getByText("Other team")).toBeTruthy();
        });

        const button = screen.getByRole("button", {
            name: "Switch to this team",
        });
        const form = button.closest("form");
        expect(form?.getAttribute("action")).toBe("/api/team/switch");
        expect(
            (form?.querySelector('[name="teamId"]') as HTMLInputElement).value,
        ).toBe("team_other");
        expect(
            (form?.querySelector('[name="organizationId"]') as HTMLInputElement)
                .value,
        ).toBe("org_b");
    });
});
