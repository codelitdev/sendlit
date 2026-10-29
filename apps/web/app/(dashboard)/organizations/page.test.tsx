import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const mocks = {
  listOrganizations: mock(),
  listOrganizationTeams: mock(),
  listOrganizationEsps: mock(),
  listOrganizationKeys: mock(),
  getOrganizationDeliveryPolicy: mock(),
  listOrganizationMembers: mock(),
  listOrganizationSendingDomains: mock(),
  createOrganizationSendingDomain: mock(),
  verifyOrganizationSendingDomain: mock(),
  revokeOrganizationSendingDomain: mock(),
  getOrganizationUsage: mock(),
  getOrganizationMailActivity: mock(),
  enterOrganizationTeam: mock(),
  listOrganizationAuditEvents: mock(),
  getOrganizationEspGrant: mock(),
  getOrganizationBilling: mock(),
  getBillingCatalog: mock(),
  createOrganizationBillingCheckout: mock(),
  createOrganizationBillingPlanChange: mock(),
  createPaidOrganizationBillingCheckout: mock(),
  createOrganizationBillingPortal: mock(),
  cancelOrganizationSubscription: mock(),
  resumeOrganizationSubscription: mock(),
  createOrganization: mock(),
  abandonPendingOrganization: mock(),
  deleteOrganization: mock(),
  clearOrganizationIdCookie: mock(),
  clearTeamIdCookie: mock(),
  navigateTo: mock(),
  createOrganizationKey: mock(),
  revokeOrganizationKey: mock(),
  getOrganizationIdFromCookie: mock(),
  selectOrganizationContext: mock(),
  notifyTeamsChanged: mock(),
  setTeamIdCookie: mock(),
  routerPush: mock(),
  routerReplace: mock(),
  reloadPage: mock(),
};

mock.module("@/lib/tokens", () => ({
  getOrganizationIdFromCookie: mocks.getOrganizationIdFromCookie,
  selectOrganizationContext: mocks.selectOrganizationContext,
  notifyTeamsChanged: mocks.notifyTeamsChanged,
  setTeamIdCookie: mocks.setTeamIdCookie,
  clearOrganizationIdCookie: mocks.clearOrganizationIdCookie,
  clearTeamIdCookie: mocks.clearTeamIdCookie,
}));

mock.module("@/lib/api", () => ({
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
  listOrganizationSendingDomains: mocks.listOrganizationSendingDomains,
  createOrganizationSendingDomain: mocks.createOrganizationSendingDomain,
  verifyOrganizationSendingDomain: mocks.verifyOrganizationSendingDomain,
  revokeOrganizationSendingDomain: mocks.revokeOrganizationSendingDomain,
  getOrganizationUsage: mocks.getOrganizationUsage,
  getOrganizationMailActivity: mocks.getOrganizationMailActivity,
  enterOrganizationTeam: mocks.enterOrganizationTeam,
  listOrganizationAuditEvents: mocks.listOrganizationAuditEvents,
  getOrganizationEspGrant: mocks.getOrganizationEspGrant,
  getOrganizationBilling: mocks.getOrganizationBilling,
  getBillingCatalog: mocks.getBillingCatalog,
  createOrganizationBillingCheckout: mocks.createOrganizationBillingCheckout,
  createOrganizationBillingPlanChange: mocks.createOrganizationBillingPlanChange,
  createPaidOrganizationBillingCheckout: mocks.createPaidOrganizationBillingCheckout,
  createOrganizationBillingPortal: mocks.createOrganizationBillingPortal,
  cancelOrganizationSubscription: mocks.cancelOrganizationSubscription,
  resumeOrganizationSubscription: mocks.resumeOrganizationSubscription,
  abandonPendingOrganization: mocks.abandonPendingOrganization,
  deleteOrganization: mocks.deleteOrganization,
  createOrganizationKey: mocks.createOrganizationKey,
  revokeOrganizationKey: mocks.revokeOrganizationKey,
  createOrganization: mocks.createOrganization,
  updateOrganization: mock(),
  addOrganizationMember: mock(),
  updateOrganizationMember: mock(),
  removeOrganizationMember: mock(),
  createOrganizationTeam: mock(),
  renameOrganizationTeam: mock(),
  archiveOrganizationTeam: mock(),
  createOrganizationEsp: mock(),
  updateOrganizationEsp: mock(),
  deleteOrganizationEsp: mock(),
  testOrganizationEsp: mock(),
  activateOrganizationEsp: mock(),
  suspendOrganizationEsp: mock(),
  resumeOrganizationEsp: mock(),
  retireOrganizationEsp: mock(),
  updateOrganizationDeliveryPolicy: mock(),
  upsertOrganizationEspGrant: mock(),
  transitionOrganizationEspGrant: mock(),
  feedbackCapableProviders: [],
  deleteEspFeedback: mock(),
  deleteOrganizationEspFeedback: mock(),
  getEspFeedback: mock(),
  getOrganizationEspFeedback: mock(),
  testEspFeedback: mock(),
  testOrganizationEspFeedback: mock(),
  upsertEspFeedback: mock(),
  upsertOrganizationEspFeedback: mock(),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

mock.module("@/lib/navigation", () => ({
  reloadPage: mocks.reloadPage,
  navigateTo: mocks.navigateTo,
}));

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { BreadcrumbProvider } = await import(
  "@/components/dashboard/breadcrumb-context"
);
const { ApiError: ClientApiError } = await import("@/lib/api-client");
const { default: OrganizationsPage } = await import("./page");

const organization = {
  organizationId: "org_1",
  name: "Acme",
  status: "active" as const,
  role: "owner" as const,
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
  mock.clearAllMocks();
  mocks.getOrganizationIdFromCookie.mockReturnValue("org_1");
  mocks.listOrganizations.mockResolvedValue({
    items: [organization],
    ownsFreeOrganization: false,
  });
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
  mocks.listOrganizationSendingDomains.mockResolvedValue({ items: [] });
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
  mocks.getOrganizationBilling.mockResolvedValue({
    plan: "oss",
    billingInterval: null,
    paymentStatus: "free",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    paidThroughAt: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    canManageBilling: true,
    entitlements: {
      teamsLimit: null,
      subscribedContactsLimit: null,
      monthlySendsLimit: null,
      sharedOrganizationMailbox: true,
      provisioning: true,
      organizationApiKeys: true,
      marketingBranding: false,
    },
    usage: {
      plan: "oss",
      paymentStatus: "free",
      teams: 0,
      subscribedContacts: 0,
      monthlySends: 0,
      monthlySendsReserved: 0,
      bucketStartsAt: "2026-08-01T00:00:00.000Z",
      bucketEndsAt: "2026-09-01T00:00:00.000Z",
      teamsLimit: null,
      subscribedContactsLimit: null,
      monthlySendsLimit: null,
    },
  });
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
    expect(screen.getByDisplayValue("sl_org_live_secret_once")).toBeTruthy();
    expect(mocks.createOrganizationKey).toHaveBeenCalledTimes(1);
    expect(mocks.listOrganizationKeys).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(mocks.listOrganizationKeys).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByDisplayValue("sl_org_live_secret_once")).toBeNull();
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
      expect(mocks.revokeOrganizationKey).toHaveBeenCalledWith("org_1", "oak_1");
    });
    await waitFor(() => {
      expect(screen.queryByText("CourseLit production")).toBeNull();
    });
  });
});

describe("billing presentation and entitlement hints", () => {
  it("implicitly creates OSS organizations without a plan selector", async () => {
    mocks.getBillingCatalog.mockResolvedValue({
      catalogRevision: null,
      currency: null,
      offers: [],
      checkoutAvailable: false,
    });
    mocks.createOrganization.mockResolvedValue(organization);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New organization" }));
    expect(await screen.findByPlaceholderText("e.g. CourseLit")).toBeTruthy();
    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).queryByText("Plan", {
          exact: true,
        }),
      ).toBeNull();
    });
    expect(screen.queryByText(/Paid checkout is not enabled/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("e.g. CourseLit"), {
      target: { value: "OSS Org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => {
      expect(mocks.createOrganization).toHaveBeenCalledWith("OSS Org");
      expect(mocks.reloadPage).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the organization plan and usage summary", async () => {
    renderPage();
    await openTab("Plan");
    expect(await screen.findByText("Plan and usage")).toBeTruthy();
    expect(screen.getByText("OSS")).toBeTruthy();
    expect(screen.getAllByText("0 · unlimited")).toHaveLength(3);
  });

  it("explains the end date and downgrade behavior for a cancelled plan", async () => {
    mocks.getOrganizationBilling.mockResolvedValue({
      plan: "business",
      billingInterval: "month",
      paymentStatus: "cancelled",
      trialEndsAt: null,
      currentPeriodEndsAt: "2099-09-12T00:00:00.000Z",
      paidThroughAt: "2099-09-12T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      canManageBilling: true,
      entitlements: {
        teamsLimit: 25,
        subscribedContactsLimit: null,
        monthlySendsLimit: null,
        sharedOrganizationMailbox: true,
        provisioning: true,
        organizationApiKeys: true,
        marketingBranding: false,
      },
      usage: {
        plan: "business",
        paymentStatus: "cancelled",
        teams: 6,
        subscribedContacts: 0,
        monthlySends: 0,
        monthlySendsReserved: 0,
        bucketStartsAt: "2026-08-01T00:00:00.000Z",
        bucketEndsAt: "2026-09-01T00:00:00.000Z",
        teamsLimit: 25,
        subscribedContactsLimit: null,
        monthlySendsLimit: null,
      },
    });

    renderPage();
    await openTab("Plan");

    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeTruthy();
    expect(await screen.findByText(/Cancellation scheduled/)).toBeTruthy();
    expect(screen.getByText(/remains active until/)).toBeTruthy();
    expect(screen.getByText(/Organizations, teams, contacts, sequences/)).toBeTruthy();
    expect(screen.getByText(/The organization moves to the Free plan/)).toBeTruthy();
    // Free's limits come from plan policy; the copy must not restate stale numbers.
    expect(screen.queryByText(/subscribed contacts, and/)).toBeNull();

    await openTab("Teams");
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage billing" })).toBeNull();
  });

  function paidBilling(overrides: Record<string, unknown> = {}) {
    return {
      plan: "pro",
      billingInterval: "month",
      paymentStatus: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: "2099-09-12T00:00:00.000Z",
      paidThroughAt: "2099-09-12T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      canManageBilling: true,
      entitlements: {
        teamsLimit: 5,
        subscribedContactsLimit: null,
        monthlySendsLimit: null,
        sharedOrganizationMailbox: true,
        provisioning: true,
        organizationApiKeys: true,
        marketingBranding: false,
      },
      usage: {
        plan: "pro",
        paymentStatus: "active",
        teams: 1,
        subscribedContacts: 0,
        monthlySends: 0,
        monthlySendsReserved: 0,
        bucketStartsAt: "2026-08-01T00:00:00.000Z",
        bucketEndsAt: "2026-09-01T00:00:00.000Z",
        teamsLimit: 5,
        subscribedContactsLimit: null,
        monthlySendsLimit: null,
      },
      pendingPlanChange: null,
      ...overrides,
    };
  }

  it("cancels a paid plan at period end after confirmation", async () => {
    mocks.getOrganizationBilling.mockResolvedValueOnce(paidBilling());
    mocks.getOrganizationBilling.mockResolvedValue(
      paidBilling({
        paymentStatus: "cancel_at_period_end",
        cancelAtPeriodEnd: true,
        // Access can end earlier than the billing period, so the UI must
        // show paidThroughAt rather than currentPeriodEndsAt.
        currentPeriodEndsAt: "2099-10-12T00:00:00.000Z",
      }),
    );
    mocks.cancelOrganizationSubscription.mockResolvedValue({
      accepted: true,
      subscriptionId: "sub_1",
    });

    renderPage();
    await openTab("Plan");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Cancel plan?")).toBeTruthy();
    expect(within(dialog).getByText(/Paid access continues until/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep plan" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));

    await waitFor(() =>
      expect(mocks.cancelOrganizationSubscription).toHaveBeenCalledWith("org_1"),
    );
    expect(await screen.findByText(/Cancellation scheduled/)).toBeTruthy();
    const accessUntil = new Date("2099-09-12T00:00:00.000Z").toLocaleDateString(
      undefined,
      { year: "numeric", month: "long", day: "numeric" },
    );
    expect(screen.getByText(`Ends ${accessUntil}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("resumes a scheduled cancellation without starting checkout", async () => {
    mocks.getOrganizationBilling.mockResolvedValueOnce(
      paidBilling({ paymentStatus: "cancel_at_period_end", cancelAtPeriodEnd: true }),
    );
    mocks.getOrganizationBilling.mockResolvedValue(paidBilling());
    mocks.resumeOrganizationSubscription.mockResolvedValue({
      accepted: true,
      subscriptionId: "sub_1",
    });

    renderPage();
    await openTab("Plan");
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() =>
      expect(mocks.resumeOrganizationSubscription).toHaveBeenCalledWith("org_1"),
    );
    expect(await screen.findByRole("button", { name: "Cancel plan" })).toBeTruthy();
    expect(screen.queryByText(/Cancellation scheduled/)).toBeNull();
    expect(mocks.createOrganizationBillingCheckout).not.toHaveBeenCalled();
  });

  it("shows the new plan once the provider confirms an immediate plan change", async () => {
    const pending = paidBilling({
      plan: "starter",
      pendingPlanChange: {
        changeId: "chg_1",
        targetPlan: "pro",
        targetInterval: "month",
        effectiveAt: "immediately",
      },
    });
    // Initial load and the first poll still see the pending change; the
    // webhook lands before the second poll.
    mocks.getOrganizationBilling
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(paidBilling());

    renderPage();
    await openTab("Plan");
    expect(
      await screen.findByText(/Plan change to Pro \(monthly\) is being confirmed/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Change plan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Real sleeps, not waitFor: waitFor stalls the page's 2-second poll timer.
    for (let i = 0; i < 40 && screen.queryByText(/is being confirmed/); i++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    }
    expect(screen.queryByText(/is being confirmed/)).toBeNull();
    expect(screen.getByText("Pro plan")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Change plan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  }, 60_000);

  it("hides cancellation controls from members who cannot manage billing", async () => {
    mocks.getOrganizationBilling.mockResolvedValue(
      paidBilling({
        paymentStatus: "cancel_at_period_end",
        cancelAtPeriodEnd: true,
        canManageBilling: false,
      }),
    );

    renderPage();
    await openTab("Plan");
    expect(await screen.findByText(/Cancellation scheduled/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
  });

  it("explains what remains after a paid plan expires", async () => {
    mocks.getOrganizationBilling.mockResolvedValue({
      plan: "free",
      billingInterval: null,
      paymentStatus: "expired",
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-08-20T00:00:00.000Z",
      paidThroughAt: "2026-08-20T00:00:00.000Z",
      cancelAtPeriodEnd: true,
      graceEndsAt: null,
      canManageBilling: true,
      entitlements: {
        teamsLimit: 1,
        subscribedContactsLimit: 1000,
        monthlySendsLimit: 3000,
        sharedOrganizationMailbox: false,
        provisioning: false,
        organizationApiKeys: false,
        marketingBranding: true,
      },
      usage: {
        plan: "free",
        paymentStatus: "expired",
        teams: 1,
        subscribedContacts: 0,
        monthlySends: 0,
        monthlySendsReserved: 0,
        bucketStartsAt: "2026-08-01T00:00:00.000Z",
        bucketEndsAt: "2026-09-01T00:00:00.000Z",
        teamsLimit: 1,
        subscribedContactsLimit: 1000,
        monthlySendsLimit: 3000,
      },
    });

    renderPage();
    await openTab("Plan");

    expect(
      await screen.findByText(/organization is now on the Free plan/),
    ).toBeTruthy();
    expect(screen.getByText(/paid plan ended on/)).toBeTruthy();
    expect(screen.getByText(/data are retained/)).toBeTruthy();
  });

  it("explains when an owned organization already has that name", async () => {
    mocks.getBillingCatalog.mockResolvedValue({
      catalogRevision: null,
      currency: null,
      offers: [],
      checkoutAvailable: false,
    });
    mocks.createOrganization.mockRejectedValue(
      new ClientApiError(409, "organization_name_already_exists"),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New organization" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. CourseLit"), {
      target: { value: "Acme" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create organization" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    expect(
      await screen.findByText(/already own an organization with this name/i),
    ).toBeTruthy();
    expect(mocks.reloadPage).not.toHaveBeenCalled();
  });

  it("explains the one-Free-organization rule", async () => {
    mocks.getBillingCatalog.mockResolvedValue({
      catalogRevision: 1,
      currency: "USD",
      checkoutAvailable: true,
      offers: [],
    });
    mocks.createOrganization.mockRejectedValue(
      new ClientApiError(409, "free_organization_already_owned"),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New organization" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. CourseLit"), {
      target: { value: "Another organization" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    expect(
      await screen.findByText(
        /already own a Free organization\. Upgrade it first, or choose Pro or Business/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("free_organization_already_owned")).toBeNull();
  });

  it("disables Free-plan organization capabilities with upgrade copy", async () => {
    mocks.getOrganizationBilling.mockResolvedValue({
      plan: "free",
      billingInterval: null,
      paymentStatus: "free",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      canManageBilling: true,
      entitlements: {
        teamsLimit: 1,
        subscribedContactsLimit: 1000,
        monthlySendsLimit: 3000,
        sharedOrganizationMailbox: false,
        provisioning: false,
        organizationApiKeys: false,
        marketingBranding: true,
      },
      usage: {
        plan: "free",
        paymentStatus: "free",
        teams: 1,
        subscribedContacts: 1000,
        monthlySends: 3000,
        monthlySendsReserved: 0,
        bucketStartsAt: "2026-08-01T00:00:00.000Z",
        bucketEndsAt: "2026-09-01T00:00:00.000Z",
        teamsLimit: 1,
        subscribedContactsLimit: 1000,
        monthlySendsLimit: 3000,
      },
    });
    renderPage();
    await openTab("Teams");
    expect(
      (
        screen.getByRole("button", {
          name: "New team",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/reached its 1-team limit/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
    await openTab("Delivery");
    expect(
      (
        screen.getByRole("button", {
          name: "New shared ESP",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Shared mailboxes are available on Pro and Business/i),
    ).toBeTruthy();
    await openTab("Keys");
    expect(
      (
        screen.getByRole("button", {
          name: "New key",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Organization API keys are available on Business and OSS/i),
    ).toBeTruthy();
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

    expect(await screen.findByText("Transactional mail activity")).toBeTruthy();
    expect(
      screen.getByText(
        "Counts are transactional only. Shared-delivery quota remains separate. No email content is shown.",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(mocks.getOrganizationMailActivity).toHaveBeenCalledWith("org_1", 7);
    });
    expect((await screen.findAllByText("School One")).length).toBeGreaterThan(0);
    expect(screen.getByText("Provisioned · school:one")).toBeTruthy();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("enters a provisioned team, then notifies the team switcher", async () => {
    renderPage();
    await openTab("Teams");
    expect((await screen.findAllByText("School One")).length).toBeGreaterThan(0);

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
      expect(mocks.enterOrganizationTeam).toHaveBeenCalledWith("org_1", "tm_school");
    });
    expect(mocks.notifyTeamsChanged).toHaveBeenCalled();
    expect(mocks.setTeamIdCookie).toHaveBeenCalledWith("tm_school");
    expect(mocks.routerPush).toHaveBeenCalledWith("/");
  });
});

describe("organization danger zone", () => {
  async function openDeleteDialog() {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete organization" }));
    return screen.findByRole("alertdialog");
  }

  it("is hidden from organization admins", async () => {
    mocks.listOrganizations.mockResolvedValue({
      items: [{ ...organization, role: "admin" }],
      ownsFreeOrganization: false,
    });
    renderPage();
    await screen.findByLabelText("Name");
    expect(screen.queryByText("Danger zone")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete organization" })).toBeNull();
  });

  it("deletes only after the owner types the organization name", async () => {
    mocks.deleteOrganization.mockResolvedValue(undefined);
    const dialog = await openDeleteDialog();
    const confirm = within(dialog).getByRole("button", { name: "Delete organization" });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "acme" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Acme" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() =>
      expect(mocks.navigateTo).toHaveBeenCalledWith("/team-selection"),
    );
    expect(mocks.deleteOrganization).toHaveBeenCalledWith("org_1");
    expect(mocks.clearTeamIdCookie).toHaveBeenCalled();
    expect(mocks.clearOrganizationIdCookie).toHaveBeenCalled();
  });

  it("points to billing while a subscription is active", async () => {
    mocks.deleteOrganization.mockRejectedValue(
      new ClientApiError(409, "active_subscription_exists"),
    );
    const dialog = await openDeleteDialog();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Acme" },
    });
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Delete organization" }),
      );
    });

    expect(await within(dialog).findByText(/has an active subscription/)).toBeTruthy();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Manage billing" }));
    });
    expect(mocks.routerReplace).toHaveBeenCalledWith(
      "/organizations?tab=plan",
      expect.anything(),
    );
  });
});
