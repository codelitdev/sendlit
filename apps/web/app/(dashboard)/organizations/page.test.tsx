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
    listOrganizationAuditEvents: vi.fn(),
    getOrganizationEspGrant: vi.fn(),
    createOrganizationKey: vi.fn(),
    revokeOrganizationKey: vi.fn(),
    getOrganizationIdFromCookie: vi.fn(),
    selectOrganizationContext: vi.fn(),
    notifyTeamsChanged: vi.fn(),
}));

vi.mock("@/lib/tokens", () => ({
    getOrganizationIdFromCookie: mocks.getOrganizationIdFromCookie,
    selectOrganizationContext: mocks.selectOrganizationContext,
    notifyTeamsChanged: mocks.notifyTeamsChanged,
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

describe("organization API keys", () => {
    it("keeps the one-time secret visible after create", async () => {
        mocks.listOrganizationKeys.mockResolvedValue({ items: [] });
        mocks.createOrganizationKey.mockResolvedValue({
            ...activeKey,
            key: "sl_org_live_secret_once",
        });

        renderPage();
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
