import { describe, expect, it } from "bun:test";
import { classifyEmails, isDisposableDomain } from "./email-domains";

describe("isDisposableDomain", () => {
  it("matches listed domains and their subdomains, case-insensitively", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("Mailinator.COM")).toBe(true);
    expect(isDisposableDomain("inbox.mailinator.com")).toBe(true);
  });

  it("leaves real providers and unlisted domains alone", () => {
    for (const domain of ["gmail.com", "outlook.com", "acme.example", "com", ""]) {
      expect(isDisposableDomain(domain)).toBe(false);
    }
    // A listed domain's suffix match must not leak to look-alikes.
    expect(isDisposableDomain("acme-mailinator.com")).toBe(false);
  });
});

describe("classifyEmails", () => {
  it("counts disposable addresses from the vendored list", () => {
    expect(
      classifyEmails(["a@mailinator.com", "info@acme.example", "b@gmail.com"]),
    ).toEqual({ total: 3, free: 1, role: 1, disposable: 1 });
  });
});
