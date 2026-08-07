import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getOAuthTeamSelection: vi.fn(),
    listTeamsForUser: vi.fn(),
    setOAuthTeamSelection: vi.fn(),
}));

vi.mock("../team/queries", () => mocks);

import {
    createSendLitOAuthTeamSelectionHooks,
    oauthTeamSelectionAdapter,
} from "./oauth-team-selection";

describe("SendLit OAuth team selection", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("maps SendLit teams to a public picker representation", async () => {
        mocks.listTeamsForUser.mockResolvedValue([
            { id: "internal-team", teamId: "team_public", name: "My Team" },
        ]);

        await expect(
            oauthTeamSelectionAdapter.listTeamsForUser("user-1"),
        ).resolves.toEqual([
            { id: "internal-team", publicId: "team_public", name: "My Team" },
        ]);
    });

    it("requires a selection only for a multi-team user without a valid selection", async () => {
        const adapter = {
            listTeamsForUser: vi.fn(async () => [
                { id: "team-a", publicId: "team_a", name: "A" },
                { id: "team-b", publicId: "team_b", name: "B" },
            ]),
            getSelectedTeamId: vi.fn(async () => null),
            setSelectedTeamId: vi.fn(),
        };
        const hooks = createSendLitOAuthTeamSelectionHooks({
            page: "https://api.sendlit.test/oauth/select-team",
            adapter,
        });

        await expect(
            hooks.postLogin.shouldRedirect({
                user: { id: "user-1" },
                session: { id: "session-1" },
            }),
        ).resolves.toBe(true);

        await expect(
            hooks.postLogin.consentReferenceId({
                user: { id: "user-1" },
                session: { id: "session-1" },
            }),
        ).resolves.toBeUndefined();
    });

    it("retains a valid selection and places only its internal ID in the token claim", async () => {
        const adapter = {
            listTeamsForUser: vi.fn(async () => [
                { id: "team-a", publicId: "team_a", name: "A" },
                { id: "team-b", publicId: "team_b", name: "B" },
            ]),
            getSelectedTeamId: vi.fn(async () => "team-b"),
            setSelectedTeamId: vi.fn(),
        };
        const hooks = createSendLitOAuthTeamSelectionHooks({
            page: "https://api.sendlit.test/oauth/select-team",
            adapter,
        });

        await expect(
            hooks.postLogin.shouldRedirect({
                user: { id: "user-1" },
                session: { id: "session-1" },
            }),
        ).resolves.toBe(false);
        await expect(
            hooks.postLogin.consentReferenceId({
                user: { id: "user-1" },
                session: { id: "session-1" },
            }),
        ).resolves.toBe("team-b");
        await expect(
            hooks.customAccessTokenClaims({ referenceId: "team-b" }),
        ).resolves.toEqual({ team_id: "team-b" });
    });
});
