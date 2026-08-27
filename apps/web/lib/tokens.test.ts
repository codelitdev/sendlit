import { describe, expect, it } from "vitest";

import { needsTeamSelection } from "./tokens";

describe("needsTeamSelection", () => {
    it("only treats team-resolution conflicts as a navigation signal", () => {
        expect(needsTeamSelection(409, "team_required")).toBe(true);
        expect(needsTeamSelection(409, "no_team")).toBe(true);
        expect(needsTeamSelection(409, "delivery_source_in_use")).toBe(false);
    });
});
