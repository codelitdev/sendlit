import { afterEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const mocks = {
  selectOrganizationContext: mock(),
};

mock.module("@/lib/tokens", () => ({
  selectOrganizationContext: mocks.selectOrganizationContext,
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { SwitchTeamForm, submitTeamSwitch } = await import("./switch-team-form");

describe("SwitchTeamForm", () => {
  afterEach(() => {
    cleanup();
    mocks.selectOrganizationContext.mockReset();
    document.body.innerHTML = "";
  });

  it("posts team and organization the way the sidebar switcher does", () => {
    render(
      <SwitchTeamForm teamId="team_123" organizationId="org_123">
        <button type="submit">Switch</button>
      </SwitchTeamForm>,
    );

    const form = document.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/api/team/switch");
    expect(form?.getAttribute("method")).toBe("POST");
    expect((form!.querySelector('[name="teamId"]') as HTMLInputElement).value).toBe(
      "team_123",
    );
    expect(
      (form!.querySelector('[name="organizationId"]') as HTMLInputElement).value,
    ).toBe("org_123");
    expect((form!.querySelector('[name="redirectTo"]') as HTMLInputElement).value).toBe(
      "/",
    );

    fireEvent.submit(form!);
    expect(mocks.selectOrganizationContext).toHaveBeenCalledWith("org_123");
  });

  it("submits a switch after creating a team, including organization", () => {
    const submit = mock();
    HTMLFormElement.prototype.submit = submit;

    submitTeamSwitch({
      teamId: "team_new",
      organizationId: "org_new",
    });

    expect(mocks.selectOrganizationContext).toHaveBeenCalledWith("org_new");
    expect(submit).toHaveBeenCalled();
    const form = document.querySelector('form[action="/api/team/switch"]');
    expect((form!.querySelector('[name="teamId"]') as HTMLInputElement).value).toBe(
      "team_new",
    );
    expect(
      (form!.querySelector('[name="organizationId"]') as HTMLInputElement).value,
    ).toBe("org_new");
  });
});
