import { afterEach, describe, expect, it } from "bun:test";
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

  it("quotes a display name that holds RFC 5322 specials", () => {
    expect(getEmailFrom({ name: "Smith, J. & Co", email: "a@example.com" })).toBe(
      '"Smith, J. & Co" <a@example.com>',
    );
    expect(getEmailFrom({ name: 'The "Best" School', email: "a@example.com" })).toBe(
      '"The \\"Best\\" School" <a@example.com>',
    );
    expect(getEmailFrom({ name: "Yoga & Co", email: "a@example.com" })).toBe(
      "Yoga & Co <a@example.com>",
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
