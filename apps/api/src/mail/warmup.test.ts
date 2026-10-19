import { describe, expect, it } from "bun:test";
import { effectiveDailySendLimit, warmupState, warmupValues } from "./warmup";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("ESP warm-up", () => {
  it("follows the ramp by UTC day and finishes at the target", () => {
    const esp = {
      warmupTargetDaily: 1_000,
      warmupStartedAt: new Date("2026-10-01T23:30:00Z"),
      dailySendLimit: null,
    };
    expect(warmupState(esp, day("2026-10-01"))).toMatchObject({
      day: 1,
      todayLimit: 50,
      totalDays: 6,
      complete: false,
    });
    expect(warmupState(esp, day("2026-10-02"))).toMatchObject({
      day: 2,
      todayLimit: 100,
    });
    expect(warmupState(esp, day("2026-10-06"))).toMatchObject({
      day: 6,
      todayLimit: 1_000,
      complete: true,
    });
    expect(effectiveDailySendLimit(esp, day("2026-10-03"))).toBe(200);
    // Done: no warm-up cap, only the ESP's own limit (none here).
    expect(effectiveDailySendLimit(esp, day("2026-10-20"))).toBeNull();
  });

  it("uses the lower of the warm-up and the ESP's own daily limit", () => {
    const esp = {
      warmupTargetDaily: 50_000,
      warmupStartedAt: day("2026-10-01"),
      dailySendLimit: 1_000,
    };
    expect(effectiveDailySendLimit(esp, day("2026-10-02"))).toBe(100);
    expect(effectiveDailySendLimit(esp, day("2026-10-10"))).toBe(1_000);
    expect(
      effectiveDailySendLimit({ ...esp, warmupTargetDaily: null }, day("2026-10-02")),
    ).toBe(1_000);
    expect(warmupState({ ...esp, warmupTargetDaily: null })).toBeNull();
  });

  it("starts, retargets and stops", () => {
    expect(warmupValues(undefined, null)).toEqual({});
    const started = warmupValues(5_000, null) as { warmupStartedAt: Date };
    expect(started).toMatchObject({ warmupTargetDaily: 5_000 });
    expect(Date.now() - started.warmupStartedAt.getTime()).toBeLessThan(1_000);
    const running = { warmupTargetDaily: 5_000, warmupStartedAt: day("2026-10-01") };
    expect(warmupValues(20_000, running)).toEqual({
      warmupTargetDaily: 20_000,
      warmupStartedAt: day("2026-10-01"),
    });
    expect(warmupValues(null, running)).toEqual({
      warmupTargetDaily: null,
      warmupStartedAt: null,
    });
  });
});
