import { describe, expect, it } from "vitest";
import {
    canActivateForOrganization,
    requiresFeedbackForOrganization,
} from "./provider-capabilities";

describe("organization ESP provider capabilities", () => {
    it("allows a tested custom SMTP transport without a webhook adapter", () => {
        expect(canActivateForOrganization("smtp")).toBe(true);
        expect(requiresFeedbackForOrganization("smtp")).toBe(false);
    });

    it("keeps reviewed providers behind feedback verification", () => {
        expect(canActivateForOrganization("resend")).toBe(true);
        expect(requiresFeedbackForOrganization("resend")).toBe(true);
        expect(requiresFeedbackForOrganization("postmark")).toBe(true);
    });
});
