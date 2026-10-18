import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const mocks = {
  listTeams: mock(),
  createTeam: mock(),
};

mock.module("@/lib/api", () => ({
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

const actualTokens = await import("@/lib/tokens");
mock.module("@/lib/tokens", () => {
  return {
    ...actualTokens,
    resolveCurrentTeamId: () => "team_current",
    selectOrganizationContext: mock(),
  };
});

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { BreadcrumbProvider } = await import(
  "@/components/dashboard/breadcrumb-context"
);
const { TeamSelectionPage } = await import("./team-selection-page");

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
    mock.clearAllMocks();
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
    expect((form!.querySelector('[name="teamId"]') as HTMLInputElement).value).toBe(
      "team_other",
    );
    expect(
      (form!.querySelector('[name="organizationId"]') as HTMLInputElement).value,
    ).toBe("org_b");
  });
});
