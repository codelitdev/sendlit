import { describe, expect, it } from "bun:test";
import type { SendingOption } from "./api";
import {
  isDeletedDeliverySource,
  presentDeliverySourceError,
  sendingOptionFor,
  sendingOptionLabel,
} from "./delivery-source";

describe("presentDeliverySourceError", () => {
  it("explains each reason an ESP cannot be removed (#12)", () => {
    expect(presentDeliverySourceError("delivery_source_in_use")).toContain(
      "sending sequence or broadcast",
    );
    expect(presentDeliverySourceError("esp_is_default")).toContain(
      "Make another ESP the default",
    );
    for (const code of ["esp_has_delivery_history", "esp_retire_instead"]) {
      expect(presentDeliverySourceError(code)).toContain("Retire it instead");
    }
  });

  it("explains paused and suspended sending instead of showing the code", () => {
    for (const code of ["sending_paused", "team_sending_suspended"]) {
      const message = presentDeliverySourceError(code);
      expect(message).not.toBe(code);
      expect(message).toStartWith("Sending is");
    }
  });
});

describe("isDeletedDeliverySource", () => {
  it("recognizes marked and legacy detached campaigns", () => {
    expect(
      isDeletedDeliverySource({
        report: { deliverySourceDeleted: true },
        status: "draft",
        deliverySource: null,
      }),
    ).toBe(true);
    expect(
      isDeletedDeliverySource({
        report: {},
        status: "completed",
        deliverySource: null,
      }),
    ).toBe(true);
    expect(
      isDeletedDeliverySource({
        report: {},
        status: "draft",
        deliverySource: null,
      }),
    ).toBe(false);
  });
});

describe("sendingOptionFor", () => {
  const option = (overrides: Record<string, unknown>) =>
    ({
      type: "team",
      espId: "esp_a",
      name: "Mailpit QA",
      fromEmail: "no-reply@example.com",
      available: true,
      isDefault: false,
      ...overrides,
    }) as SendingOption;
  const mailpit = option({ isDefault: true });
  const sendgrid = option({
    espId: "esp_b",
    name: "SendGrid",
    fromEmail: "hi@example.com",
  });
  const shared = option({ type: "organization", espId: undefined, name: "Shared SES" });

  it("uses the chosen source, else the team default", () => {
    expect(
      sendingOptionFor([mailpit, sendgrid], { type: "team", espId: "esp_b" }),
    ).toBe(sendgrid);
    expect(
      sendingOptionFor([mailpit, sendgrid, shared], { type: "organization" }),
    ).toBe(shared);
    expect(sendingOptionFor([mailpit, sendgrid], null)).toBe(mailpit);
  });

  it("falls back to the only source, and gives up when it can't tell", () => {
    expect(sendingOptionFor([sendgrid], undefined)).toBe(sendgrid);
    expect(sendingOptionFor([sendgrid, option({ espId: "esp_c" })], null)).toBeNull();
    expect(
      sendingOptionFor([mailpit, { ...sendgrid, available: false }], {
        type: "team",
        espId: "esp_b",
      }),
    ).toBeNull();
  });

  it("labels sources with their sender", () => {
    expect(sendingOptionLabel(sendgrid)).toBe("SendGrid (hi@example.com)");
    expect(sendingOptionLabel(shared)).toBe(
      "Shared: Shared SES (no-reply@example.com)",
    );
  });
});
