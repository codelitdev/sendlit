import { describe, expect, it } from "bun:test";
import { sequenceSendEarlyByMs } from "./send-timing";

const DAY = 86_400_000;
const enrolledAt = new Date("2026-11-02T09:00:00Z");
const before = new Date("2026-11-01T00:00:00Z");
const first = { emailId: "email_a", delayInMillis: 13 * DAY, updatedAt: before };
const second = { emailId: "email_b", delayInMillis: 2 * DAY, updatedAt: before };
const emails = [first, second];

describe("sequenceSendEarlyByMs", () => {
  it("reports a first email sent before its delay", () => {
    expect(
      sequenceSendEarlyByMs({
        enrolledAt,
        sentEmailIds: [],
        email: first,
        emails,
        now: enrolledAt.getTime() + DAY,
      }),
    ).toBe(12 * DAY);
  });

  it("adds up the delays of the emails already sent", () => {
    expect(
      sequenceSendEarlyByMs({
        enrolledAt,
        sentEmailIds: ["email_a"],
        email: second,
        emails,
        now: enrolledAt.getTime() + 14 * DAY,
      }),
    ).toBe(DAY);
  });

  it("is null on time, within the tolerance, or late", () => {
    for (const offset of [15 * DAY - 30_000, 15 * DAY, 20 * DAY]) {
      expect(
        sequenceSendEarlyByMs({
          enrolledAt,
          sentEmailIds: ["email_a"],
          email: second,
          emails,
          now: enrolledAt.getTime() + offset,
        }),
      ).toBeNull();
    }
  });

  it("is null when an email involved changed after the contact entered", () => {
    expect(
      sequenceSendEarlyByMs({
        enrolledAt,
        sentEmailIds: [],
        email: { ...first, updatedAt: new Date(enrolledAt.getTime() + 1000) },
        emails,
        now: enrolledAt.getTime(),
      }),
    ).toBeNull();
  });

  it("is null when a sent email no longer exists or the entry time is unknown", () => {
    const args = { sentEmailIds: ["email_gone"], email: second, emails, now: 0 };
    expect(sequenceSendEarlyByMs({ ...args, enrolledAt })).toBeNull();
    expect(
      sequenceSendEarlyByMs({ ...args, sentEmailIds: [], enrolledAt: null }),
    ).toBeNull();
  });
});
