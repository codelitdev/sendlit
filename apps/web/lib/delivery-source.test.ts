import { describe, expect, it } from "bun:test";
import { isDeletedDeliverySource, presentDeliverySourceError } from "./delivery-source";

describe("presentDeliverySourceError", () => {
  it("explains why an ESP cannot be removed", () => {
    expect(presentDeliverySourceError("delivery_source_in_use")).toBe(
      "This ESP can't be removed while it is used by an active sequence, queued email, or delivery integration.",
    );
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
