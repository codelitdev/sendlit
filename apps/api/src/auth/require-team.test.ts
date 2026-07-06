import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireTeam } from "./require-team";

const mocks = vi.hoisted(() => ({
    getTeamMembership: vi.fn(),
    listTeamsForAccount: vi.fn(),
}));

vi.mock("../team/queries", () => ({
    getTeamMembership: mocks.getTeamMembership,
    listTeamsForAccount: mocks.listTeamsForAccount,
}));

function res() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
    };
}

describe("requireTeam", () => {
    beforeEach(() => {
        mocks.getTeamMembership.mockReset();
        mocks.listTeamsForAccount.mockReset();
    });

    it("passes through API-key requests that already have a team", async () => {
        const req = { teamId: "team-1", headers: {} } as any;
        const response = res();
        const next = vi.fn();

        await requireTeam(req, response as any, next);

        expect(next).toHaveBeenCalled();
        expect(mocks.listTeamsForAccount).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated requests before resolving a team", async () => {
        const response = res();
        await requireTeam({ headers: {} } as any, response as any, vi.fn());

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({ error: "unauthorized" });
    });

    it("validates explicit team headers against membership", async () => {
        mocks.getTeamMembership.mockResolvedValueOnce(null);
        const response = res();

        await requireTeam(
            {
                accountId: "account-1",
                headers: { "x-sendlit-team-id": "team-1" },
            } as any,
            response as any,
            vi.fn(),
        );

        expect(mocks.getTeamMembership).toHaveBeenCalledWith(
            "team-1",
            "account-1",
        );
        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: "not_a_team_member" }),
        );
    });

    it("uses an explicit team header when membership exists", async () => {
        mocks.getTeamMembership.mockResolvedValueOnce({ role: "owner" });
        const req = {
            accountId: "account-1",
            headers: { "x-sendlit-team-id": "team-1" },
        } as any;
        const next = vi.fn();

        await requireTeam(req, res() as any, next);

        expect(req.teamId).toBe("team-1");
        expect(next).toHaveBeenCalled();
    });

    it("auto-selects the only team and requires a header for multiple teams", async () => {
        mocks.listTeamsForAccount.mockResolvedValueOnce([
            { id: "team-1", name: "Solo" },
        ]);
        const soloReq = { accountId: "account-1", headers: {} } as any;
        const soloNext = vi.fn();

        await requireTeam(soloReq, res() as any, soloNext);
        expect(soloReq.teamId).toBe("team-1");
        expect(soloNext).toHaveBeenCalled();

        mocks.listTeamsForAccount.mockResolvedValueOnce([
            { id: "team-1", name: "One" },
            { id: "team-2", name: "Two" },
        ]);
        const response = res();
        await requireTeam(
            { accountId: "account-1", headers: {} } as any,
            response as any,
            vi.fn(),
        );

        expect(response.status).toHaveBeenCalledWith(409);
        expect(response.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: "team_required",
                teams: [
                    { id: "team-1", name: "One" },
                    { id: "team-2", name: "Two" },
                ],
            }),
        );
    });
});
