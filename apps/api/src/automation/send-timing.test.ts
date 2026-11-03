import { describe, expect, it } from "bun:test";
import { sequenceSendEarlyByMs } from "./send-timing";

const DAY = 86_400_000;
const enrolledAt = new Date("2026-11-02T09:00:00Z");
const before = new Date("2026-11-01T00:00:00Z");
const email = { delayInMillis: 13 * DAY, updatedAt: before };
const base = { enrolledAt, sentEmailIds: [], email, sequenceUpdatedAt: before };

describe("sequenceSendEarlyByMs", () => {
  it("reports a first email sent before its delay", () => {
    expect(sequenceSendEarlyByMs({ ...base, now: enrolledAt.getTime() + DAY })).toBe(
      12 * DAY,
    );
  });

  it("is null on time, within the tolerance, or late", () => {
    for (const offset of [13 * DAY - 30_000, 13 * DAY, 20 * DAY]) {
      expect(
        sequenceSendEarlyByMs({ ...base, now: enrolledAt.getTime() + offset }),
      ).toBeNull();
    }
  });

  it("doesn't check later emails, whose timing reordering can change", () => {
    expect(
      sequenceSendEarlyByMs({ ...base, sentEmailIds: ["email_a"], now: 0 }),
    ).toBeNull();
  });

  it("is null when the email or the sequence changed after the contact entered", () => {
    const later = new Date(enrolledAt.getTime() + 1000);
    expect(
      sequenceSendEarlyByMs({ ...base, email: { ...email, updatedAt: later }, now: 0 }),
    ).toBeNull();
    expect(
      sequenceSendEarlyByMs({ ...base, sequenceUpdatedAt: later, now: 0 }),
    ).toBeNull();
  });

  it("is null when the entry time is unknown", () => {
    expect(sequenceSendEarlyByMs({ ...base, enrolledAt: null, now: 0 })).toBeNull();
  });
});
