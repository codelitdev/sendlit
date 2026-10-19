import { describe, expect, it } from "bun:test";
import {
  guessContactImportField,
  guessImportStatusFromFileName,
  normalizeImportStatus,
} from "./contact-import";

describe("guessContactImportField", () => {
  it("recognises common export headers", () => {
    expect(guessContactImportField("Email Address")).toBe("email");
    expect(guessContactImportField("EMAIL")).toBe("email");
    expect(guessContactImportField("First Name")).toBe("first_name");
    expect(guessContactImportField("LNAME")).toBe("last_name");
    expect(guessContactImportField("status")).toBe("status");
    expect(guessContactImportField("OPTIN_TIME")).toBe("created_at");
    expect(guessContactImportField("created_at")).toBe("created_at");
    expect(guessContactImportField("tier")).toBe("tag_from_value");
    expect(guessContactImportField("TAGS")).toBe("tags");
    expect(guessContactImportField("utm_source")).toBe("custom_field");
    expect(guessContactImportField("suppression_reason")).toBe("ignore");
  });
});

describe("normalizeImportStatus", () => {
  it("maps beehiiv, Mailchimp and generic statuses", () => {
    expect(normalizeImportStatus("Active")).toEqual({ status: "subscribed" });
    expect(normalizeImportStatus(undefined)).toEqual({ status: "subscribed" });
    expect(normalizeImportStatus("Paused")).toEqual({
      status: "subscribed",
      tag: "paused",
    });
    expect(normalizeImportStatus("Inactive")).toEqual({ status: "unsubscribed" });
    expect(normalizeImportStatus("unsubscribed")).toEqual({ status: "unsubscribed" });
    expect(normalizeImportStatus("cleaned")).toEqual({ status: "bounced" });
    expect(normalizeImportStatus("Bounced")).toEqual({ status: "bounced" });
    expect(normalizeImportStatus("spam complaint")).toEqual({ status: "complained" });
    expect(normalizeImportStatus("Needs Approval")).toEqual({
      skip: "pending_confirmation",
    });
    expect(normalizeImportStatus("Pending")).toEqual({ skip: "pending_confirmation" });
    expect(normalizeImportStatus("archived")).toEqual({ skip: "unknown_status" });
    expect(normalizeImportStatus("deactivated")).toEqual({ status: "unsubscribed" });
  });
});

describe("guessImportStatusFromFileName", () => {
  it("reads Mailchimp's per-type export files", () => {
    expect(
      guessImportStatusFromFileName("subscribed_email_audience_export_3f2a.csv"),
    ).toBe("subscribed");
    expect(
      guessImportStatusFromFileName("unsubscribed_email_audience_export_3f2a.csv"),
    ).toBe("unsubscribed");
    expect(
      guessImportStatusFromFileName("nonsubscribed_email_audience_export.csv"),
    ).toBe("unsubscribed");
    expect(guessImportStatusFromFileName("Cleaned_members_export.csv")).toBe("bounced");
    expect(guessImportStatusFromFileName("beehiiv-subscribers.csv")).toBeNull();
  });
});
