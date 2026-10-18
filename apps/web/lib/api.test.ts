import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@sendlit/test-utils";
import { resetAppModules } from "./test/reset-modules";

const mocks = {
  contactsList: mock(),
};

const actual = await import("@ts-rest/core");
mock.module("@ts-rest/core", () => {
  return {
    ...actual,
    initClient: () => ({
      contacts: {
        list: mocks.contactsList,
      },
    }),
  };
});

function installWindow(pathname = "/sequences") {
  const location = { href: pathname, pathname };
  stubGlobal("window", { location });
  return location;
}

describe("dashboard API client auth handling", () => {
  beforeEach(() => {
    resetAppModules();
    mocks.contactsList.mockReset();
  });

  afterEach(() => {
    unstubAllGlobals();
  });

  it("redirects to login on any 401 response", async () => {
    const location = installWindow();
    mocks.contactsList.mockResolvedValue({
      status: 401,
      body: { error: "unauthorized" },
    });

    const { listContacts } = await import("./api");
    void listContacts();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(location.href).toBe("/login");
  });

  it("does not sign out on billing recent-authentication 401", async () => {
    const location = installWindow("/organizations");
    const fetchMock = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/sign-out")) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "recent_authentication_required" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    stubGlobal("fetch", fetchMock);
    stubGlobal("document", { cookie: "" });

    const { createOrganizationBillingCheckout } = await import("./api");
    await expect(
      createOrganizationBillingCheckout("org_cB2kKmowUP3UeOHPYpzcp8S6", {
        plan: "pro",
        interval: "month",
        catalogRevision: 1,
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: "recent_authentication_required",
    });
    expect(location.href).toBe("/organizations");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/api/proxy/billing/action-token"),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/api/auth/sign-out") &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it.each([
    ["cancelOrganizationSubscription", "cancel"],
    ["resumeOrganizationSubscription", "resume"],
  ] as const)("%s posts with a cancellation action token", async (helper, path) => {
    installWindow("/organizations");
    const fetchMock = mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const body = url.endsWith("/billing/action-token")
        ? { token: "bat_1", expiresAt: "2099-01-01T00:00:00.000Z" }
        : { accepted: true, subscriptionId: "sub_1" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    stubGlobal("fetch", fetchMock);
    stubGlobal("document", { cookie: "sendlit_csrf=csrf_1" });

    const api = await import("./api");
    const organizationId = "org_cB2kKmowUP3UeOHPYpzcp8S6";
    await expect(api[helper](organizationId)).resolves.toEqual({
      accepted: true,
      subscriptionId: "sub_1",
    });

    expect(fetchMock.mock.calls).toHaveLength(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("/api/proxy/billing/action-token");
    expect(tokenInit.method).toBe("POST");
    expect(JSON.parse(String(tokenInit.body))).toEqual({
      action: "cancellation",
      target: organizationId,
    });

    const [actionUrl, actionInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(actionUrl).toBe(
      `/api/proxy/organizations/${organizationId}/billing/${path}`,
    );
    expect(actionInit.method).toBe("POST");
    expect(actionInit.body).toBeUndefined();
    expect(actionInit.headers).toMatchObject({
      "X-Sendlit-CSRF": "csrf_1",
      "X-Sendlit-Billing-Action-Token": "bat_1",
    });
  });
});
