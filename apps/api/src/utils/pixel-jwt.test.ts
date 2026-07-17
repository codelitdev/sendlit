import { afterEach, describe, expect, it } from "vitest";
import { generatePixelToken, verifyPixelToken } from "./pixel-jwt";

const ORIGINAL = process.env.PIXEL_SIGNING_SECRET;

afterEach(() => {
    process.env.PIXEL_SIGNING_SECRET = ORIGINAL;
});

describe("pixel JWT", () => {
    it("signs and verifies a payload", () => {
        const token = generatePixelToken({ d: "delivery-1", a: "open" });
        expect(verifyPixelToken<{ d: string; a: string }>(token)).toMatchObject(
            {
                d: "delivery-1",
                a: "open",
            },
        );
    });

    it("returns null for a tampered or wrong-secret token", () => {
        const token = generatePixelToken({ d: "x" });
        expect(verifyPixelToken(token + "x")).toBeNull();

        process.env.PIXEL_SIGNING_SECRET = "other-secret";
        expect(verifyPixelToken(token)).toBeNull();
    });

    it("throws when the signing secret is missing", () => {
        delete process.env.PIXEL_SIGNING_SECRET;
        expect(() => generatePixelToken({ d: "x" })).toThrow(
            /PIXEL_SIGNING_SECRET/,
        );
    });
});
