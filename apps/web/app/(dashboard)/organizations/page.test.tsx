// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    listOrganizations: vi.fn(),
    listOrganizationTeams: vi.fn(),
    listOrganizationEsps: vi.fn(),
    listOrganizationKeys: vi.fn(),
    getOrganizationDeliveryPolicy: vi.fn(),
    listOrganizationMembers: vi.fn(),
    getOrganizationUsage: vi.fn(),
    getOrganizationMailActivity: vi.fn(),
    enterOrganizationTeam: vi.fn(),
    listOrganizationAuditEvents: vi.fn(),
    getOrganizationEspGrant: vi.fn(),
    createOrganizationKey: vi.fn(),
    revokeOrganizationKey: vi.fn(),
    getOrganizationIdFromCookie: vi.fn(),
    selectOrganizationContext: vi.fn(),
    notifyTeamsChanged: vi.fn(),
    setTeamIdCookie: vi.fn(),
    routerPush: vi.fn(),
    routerReplace: vi.fn(),
}));

vi.mock("@/lib/tokens", () => ({
    getOrganizationIdFromCookie: mocks.getOrganizationIdFromCookie,
    selectOrganizationContext: mocks.selectOrganizationContext,
    notifyTeamsChanged: mocks.notifyTeamsChanged,
    setTeamIdCookie: mocks.setTeamIdCookie,
}));

vi.mock("@/lib/api", () => ({
    ApiError: class ApiError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    },
    listOrganizations: mocks.listOrganizations,
    listOrganizationTeams: mocks.listOrganizationTeams,
    listOrganizationEsps: mocks.listOrganizationEsps,
    listOrganizationKeys: mocks.listOrganizationKeys,
    getOrganizationDeliveryPolicy: mocks.getOrganizationDeliveryPolicy,
    listOrganizationMembers: mocks.listOrganizationMembers,
    getOrganizationUsage: mocks.getOrganizationUsage,
    getOrganizationMailActivity: mocks.getOrganizationMailActivity,
    enterOrganizationTeam: mocks.enterOrganizationTeam,
    listOrganizationAuditEvents: mocks.listOrganizationAuditEvents,
    getOrganizationEspGrant: mocks.getOrganizationEspGrant,
    createOrganizationKey: mocks.createOrganizationKey,
    revokeOrganizationKey: mocks.revokeOrganizationKey,
    createOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    addOrganizationMember: vi.fn(),
    updateOrganizationMember: vi.fn(),
    removeOrganizationMember: vi.fn(),
    createOrganizationTeam: vi.fn(),
    renameOrganizationTeam: vi.fn(),
    archiveOrganizationTeam: vi.fn(),
    createOrganizationEsp: vi.fn(),
    updateOrganizationEsp: vi.fn(),
    deleteOrganizationEsp: vi.fn(),
    testOrganizationEsp: vi.fn(),
    activateOrganizationEsp: vi.fn(),
    suspendOrganizationEsp: vi.fn(),
    resumeOrganizationEsp: vi.fn(),
    retireOrganizationEsp: vi.fn(),
    updateOrganizationDeliveryPolicy: vi.fn(),
    upsertOrganizationEspGrant: vi.fn(),
    transitionOrganizationEspGrant: vi.fn(),
    feedbackCapableProviders: [],
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: mocks.routerPush,
        replace: mocks.routerReplace,
    }),
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
    ApiError: class ApiError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    },
}));

import OrganizationsPage from "./page";
import { BreadcrumbProvider } from "@/components/dashboard/breadcrumb-context";

const organization = {
    organizationId: "org_1",
    name: "Acme",
    status: "active" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
};

const activeKey = {
    keyId: "oak_1",
    name: "CourseLit production",
    keyPrefix: "sl_org_liv",
    scopes: ["organization:read"] as const,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
};

const usageWindow = {
    limit: null,
    accepted: 0,
    reserved: 0,
    remaining: null,
    resetsAt: "2026-08-02T00:00:00.000Z",
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationIdFromCookie.mockReturnValue("org_1");
    mocks.listOrganizations.mockResolvedValue({ items: [organization] });
    mocks.listOrganizationTeams.mockResolvedValue({ items: [] });
    mocks.listOrganizationEsps.mockResolvedValue({ items: [] });
    mocks.listOrganizationKeys.mockResolvedValue({ items: [activeKey] });
    mocks.getOrganizationDeliveryPolicy.mockResolvedValue({
        defaultEspId: null,
        autoGrantDefaultEsp: false,
        defaultDailyLimit: null,
        defaultMonthlyLimit: null,
        aggregateDailyLimit: null,
        aggregateMonthlyLimit: null,
        teamEspEnabledByDefault: false,
        teamCanChangeDefault: false,
        updatedAt: "2026-08-01T00:00:00.000Z",
    });
    mocks.listOrganizationMembers.mockResolvedValue({ items: [] });
    mocks.getOrganizationUsage.mockResolvedValue({
        day: usageWindow,
        month: usageWindow,
    });
    mocks.getOrganizationMailActivity.mockResolvedValue({
        rangeDays: 7,
        totals: { sent: 0, queued: 0, failed: 0, bounced: 0 },
        teams: [],
    });
    mocks.enterOrganizationTeam.mockResolvedValue({
        teamId: "tm_school",
        role: "admin",
        created: true,
    });
    mocks.listOrganizationAuditEvents.mockResolvedValue({ items: [] });
    mocks.getOrganizationEspGrant.mockResolvedValue(null);
});

afterEach(() => cleanup());

function renderPage() {
    return render(
        <BreadcrumbProvider>
            <OrganizationsPage />
        </BreadcrumbProvider>,
    );
}

async function openTab(name: string) {
    fireEvent.click(await screen.findByRole("tab", { name }));
}

describe("organization API keys", () => {
    it("keeps the one-time secret visible after create", async () => {
        mocks.listOrganizationKeys.mockResolvedValue({ items: [] });
        mocks.createOrganizationKey.mockResolvedValue({
            ...activeKey,
            key: "sl_org_live_secret_once",
        });

        renderPage();
        await openTab("Keys");
        fireEvent.click(await screen.findByRole("button", { name: "New key" }));
        fireEvent.change(screen.getByPlaceholderText("CourseLit production"), {
            target: { value: "CI key" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create key" }));

        expect(await screen.findByText("Store this key now")).toBeTruthy();
        expect(
            screen.getByDisplayValue("sl_org_live_secret_once"),
        ).toBeTruthy();
        expect(mocks.createOrganizationKey).toHaveBeenCalledTimes(1);
        expect(mocks.listOrganizationKeys).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        await waitFor(() => {
            expect(mocks.listOrganizationKeys).toHaveBeenCalledTimes(2);
        });
        expect(
            screen.queryByDisplayValue("sl_org_live_secret_once"),
        ).toBeNull();
    });

    it("hides a key after it is revoked", async () => {
        mocks.revokeOrganizationKey.mockResolvedValue(undefined);
        mocks.listOrganizationKeys
            .mockResolvedValueOnce({ items: [activeKey] })
            .mockResolvedValue({
                items: [
                    {
                        ...activeKey,
                        revokedAt: "2026-08-18T00:00:00.000Z",
                    },
                ],
            });

        renderPage();
        await openTab("Keys");
        expect(await screen.findByText("CourseLit production")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
        await waitFor(() => {
            expect(mocks.revokeOrganizationKey).toHaveBeenCalledWith(
                "org_1",
                "oak_1",
            );
        });
        await waitFor(() => {
            expect(screen.queryByText("CourseLit production")).toBeNull();
        });
    });
});

const provisionedTeam = {
    teamId: "tm_school",
    name: "School One",
    status: "active" as const,
    externalId: "school:one",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    viewerIsMember: false,
};

describe("transactional mail activity and enter team", () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
            configurable: true,
            value: () => false,
        });
        Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
            configurable: true,
            value: () => {},
        });
        Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
            configurable: true,
            value: () => {},
        });
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
            configurable: true,
            value: () => {},
        });
        mocks.listOrganizationTeams.mockResolvedValue({
            items: [provisionedTeam],
        });
        mocks.getOrganizationMailActivity.mockResolvedValue({
            rangeDays: 7,
            totals: { sent: 4, queued: 1, failed: 2, bounced: 0 },
            teams: [
                {
                    teamId: "tm_school",
                    name: "School One",
                    status: "active",
                    externalId: "school:one",
                    mail: { sent: 4, queued: 1, failed: 2, bounced: 0 },
                },
            ],
        });
    });

    it("loads metrics from getOrganizationMailActivity with the default 7-day range", async () => {
        renderPage();
        await openTab("Activity");

        expect(
            await screen.findByText("Transactional mail activity"),
        ).toBeTruthy();
        expect(
            screen.getByText(
                "Counts are transactional only. Shared-delivery quota remains separate. No email content is shown.",
            ),
        ).toBeTruthy();
        await waitFor(() => {
            expect(mocks.getOrganizationMailActivity).toHaveBeenCalledWith(
                "org_1",
                7,
            );
        });
        expect(
            (await screen.findAllByText("School One")).length,
        ).toBeGreaterThan(0);
        expect(screen.getByText("Provisioned · school:one")).toBeTruthy();
        expect(screen.getAllByText("4").length).toBeGreaterThan(0);
        expect(screen.getAllByText("1").length).toBeGreaterThan(0);
        expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    });

    it("enters a provisioned team, then notifies the team switcher", async () => {
        renderPage();
        await openTab("Teams");
        expect(
            (await screen.findAllByText("School One")).length,
        ).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole("button", { name: "Enter team" }));

        expect(
            await screen.findByText(
                "You will become a team admin and can see this team’s contacts, campaigns, and mail history. This is recorded in organization audit activity.",
            ),
        ).toBeTruthy();

        const confirmButtons = screen.getAllByRole("button", {
            name: "Enter team",
        });
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
            expect(mocks.enterOrganizationTeam).toHaveBeenCalledWith(
                "org_1",
                "tm_school",
            );
        });
        expect(mocks.notifyTeamsChanged).toHaveBeenCalled();
        expect(mocks.setTeamIdCookie).toHaveBeenCalledWith("tm_school");
        expect(mocks.routerPush).toHaveBeenCalledWith("/");
    });
});
