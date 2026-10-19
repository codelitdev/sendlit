import { describe, expect, it } from "bun:test";
import type { Sequence } from "@sendlit/email-blocks";
import { presentBroadcastStatus } from "./broadcast";

const broadcast = (status: string, lockedAt: number | null) =>
  ({
    status,
    report: { broadcast: { lockedAt, sentAt: null } },
    emails: [{ delayInMillis: 0 }],
  }) as unknown as Sequence;

describe("presentBroadcastStatus", () => {
  it("shows a broadcast paused mid-send as paused, a cancelled schedule as draft", () => {
    expect(presentBroadcastStatus(broadcast("paused", Date.now())).label).toBe(
      "paused",
    );
    expect(presentBroadcastStatus(broadcast("paused", null)).label).toBe("draft");
    expect(presentBroadcastStatus(broadcast("active", Date.now())).label).toBe(
      "sending",
    );
  });
});
