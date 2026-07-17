import { describe, expect, it } from "vitest";
import { constantTimeEqual, headerString } from "./header-utils";

describe("header-utils", () => {
    it("reads express-style lowercase keys and flattens arrays", () => {
        // Express lowercases header names; lookup also tries the lowercased
        // form of the requested name so either casing works for the query.
        expect(
            headerString(
                { "x-sendlit-webhook-secret": "abc" },
                "X-SendLit-Webhook-Secret",
            ),
        ).toBe("abc");
        expect(
            headerString({ "svix-id": ["first", "second"] }, "svix-id"),
        ).toBe("first");
        expect(headerString({}, "missing")).toBe("");
    });

    it("compares secrets in constant time", () => {
        expect(constantTimeEqual("same-secret", "same-secret")).toBe(true);
        expect(constantTimeEqual("same-secret", "other-secret")).toBe(false);
        expect(constantTimeEqual("short", "longer-value")).toBe(false);
    });
});
