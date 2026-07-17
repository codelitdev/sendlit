import { afterEach, describe, expect, it } from "vitest";
import { getEmailFrom, getSiteUrl, getUnsubLink } from "./mail";

const ORIGINAL = {
    PROTOCOL: process.env.PROTOCOL,
    DOMAIN: process.env.DOMAIN,
};

afterEach(() => {
    process.env.PROTOCOL = ORIGINAL.PROTOCOL;
    process.env.DOMAIN = ORIGINAL.DOMAIN;
});

describe("mail utils", () => {
    it("formats a From header", () => {
        expect(getEmailFrom({ name: "Ada", email: "ada@example.com" })).toBe(
            "Ada <ada@example.com>",
        );
    });

    it("builds site and unsubscribe URLs from env", () => {
        process.env.PROTOCOL = "https";
        process.env.DOMAIN = "app.sendlit.test";
        expect(getSiteUrl()).toBe("https://app.sendlit.test");
        expect(getUnsubLink("tok_abc")).toBe(
            "https://app.sendlit.test/unsubscribe/tok_abc",
        );
    });
});
