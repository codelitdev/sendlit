import { describe, expect, it } from "bun:test";
import { warmupDailyLimit, warmupDays } from "./schemas/esp";

describe("warm-up ramp", () => {
  it("starts small, grows daily and stops at the target", () => {
    expect(warmupDailyLimit(0, 10_000)).toBe(50);
    expect(warmupDailyLimit(1, 10_000)).toBe(100);
    expect(warmupDailyLimit(9, 10_000)).toBe(10_000);
    expect(warmupDailyLimit(15, 1_000_000)).toBe(100_000);
    expect(warmupDailyLimit(16, 1_000_000)).toBe(140_000);
    expect(warmupDays(10_000)).toBe(10);
    expect(warmupDays(100)).toBe(2);
  });
});
