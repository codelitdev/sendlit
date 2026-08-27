import { describe, expect, it } from "vitest";
import {
    isDeletedDeliverySource,
    presentDeliverySourceError,
} from "./delivery-source";

describe("presentDeliverySourceError", () => {
    it("explains why an ESP cannot be removed", () => {
        expect(presentDeliverySourceError("delivery_source_in_use")).toBe(
            "This ESP can't be removed while it is used by an active sequence, queued email, or delivery integration.",
        );
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
