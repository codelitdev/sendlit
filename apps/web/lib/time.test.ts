import { describe, expect, it } from "bun:test";
import { formatDuration, timeUntil } from "./time";

describe("timeUntil", () => {
  const now = Date.parse("2026-11-02T09:00:00Z");

  it("reads due and overdue times as now", () => {
    expect(timeUntil(now + 30_000, now)).toBe("now");
    expect(timeUntil(now - 3_600_000, now)).toBe("now");
  });

  it("counts minutes, hours, then days", () => {
    expect(timeUntil(now + 60_000, now)).toBe("in 1 minute");
    expect(timeUntil(now + 5 * 3_600_000, now)).toBe("in 5 hours");
    expect(timeUntil(now + 13 * 86_400_000, now)).toBe("in 13 days");
  });
});

describe("formatDuration", () => {
  it("picks minutes, hours or days", () => {
    expect(formatDuration(30 * 60_000)).toBe("30 minutes");
    expect(formatDuration(2 * 3_600_000)).toBe("2 hours");
    expect(formatDuration(13 * 86_400_000)).toBe("13 days");
    expect(formatDuration(1.5 * 86_400_000)).toBe("36 hours");
    expect(formatDuration(2.5 * 86_400_000)).toBe("2.5 days");
  });
});
