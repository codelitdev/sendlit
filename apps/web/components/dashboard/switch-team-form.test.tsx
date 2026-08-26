// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    selectOrganizationContext: vi.fn(),
}));

vi.mock("@/lib/tokens", () => ({
    selectOrganizationContext: mocks.selectOrganizationContext,
}));

import { submitTeamSwitch, SwitchTeamForm } from "./switch-team-form";

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
        expect(
            (form?.querySelector('[name="teamId"]') as HTMLInputElement).value,
        ).toBe("team_123");
        expect(
            (form?.querySelector('[name="organizationId"]') as HTMLInputElement)
                .value,
        ).toBe("org_123");
        expect(
            (form?.querySelector('[name="redirectTo"]') as HTMLInputElement)
                .value,
        ).toBe("/");

        fireEvent.submit(form!);
        expect(mocks.selectOrganizationContext).toHaveBeenCalledWith("org_123");
    });

    it("submits a switch after creating a team, including organization", () => {
        const submit = vi.fn();
        HTMLFormElement.prototype.submit = submit;

        submitTeamSwitch({
            teamId: "team_new",
            organizationId: "org_new",
        });

        expect(mocks.selectOrganizationContext).toHaveBeenCalledWith("org_new");
        expect(submit).toHaveBeenCalled();
        const form = document.querySelector('form[action="/api/team/switch"]');
        expect(
            (form?.querySelector('[name="teamId"]') as HTMLInputElement).value,
        ).toBe("team_new");
        expect(
            (form?.querySelector('[name="organizationId"]') as HTMLInputElement)
                .value,
        ).toBe("org_new");
    });
});
