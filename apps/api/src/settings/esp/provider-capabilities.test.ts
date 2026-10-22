import { describe, expect, it } from "bun:test";
import {
  canActivateForOrganization,
  requiresFeedbackForOrganization,
  withoutProviderTracking,
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

describe("provider tracking switches", () => {
  const both = { opens: true, clicks: true };

  it("turns off the ESP's own tracking where it has a per-message switch", () => {
    expect(
      JSON.parse(
        withoutProviderTracking("sendgrid", undefined, both)?.["X-SMTPAPI"] ?? "",
      ),
    ).toEqual({
      filters: {
        clicktrack: { settings: { enable: 0, enable_text: false } },
        opentrack: { settings: { enable: 0 } },
      },
    });
    expect(withoutProviderTracking("mailgun", { "X-Custom": "1" }, both)).toEqual({
      "X-Mailgun-Track-Clicks": "no",
      "X-Mailgun-Track-Opens": "no",
      "X-Custom": "1",
    });
    expect(
      withoutProviderTracking("postmark", undefined, { opens: false, clicks: true }),
    ).toEqual({
      "X-PM-TrackLinks": "None",
    });
  });

  it("leaves headers alone when SendLit doesn't track or the ESP has no switch", () => {
    const headers = { "List-Unsubscribe": "<x>" };
    for (const provider of ["ses", "resend", "smtp", null]) {
      expect(withoutProviderTracking(provider, headers, both)).toBe(headers);
    }
    expect(
      withoutProviderTracking("sendgrid", headers, { opens: false, clicks: false }),
    ).toBe(headers);
  });
});
