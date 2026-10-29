import { describe, expect, it } from "bun:test";
import type { Sequence } from "@sendlit/email-blocks";
import { broadcastDeleteActions, presentBroadcastStatus } from "./broadcast";

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

describe("broadcastDeleteActions", () => {
  const scheduled = {
    status: "active",
    report: {},
    emails: [{ delayInMillis: Date.now() + 3_600_000 }],
  } as unknown as Sequence;

  it("deletes drafts and scheduled broadcasts, archives sent ones", () => {
    expect(broadcastDeleteActions(broadcast("draft", null))).toMatchObject({
      delete: { allowed: true },
      archive: { allowed: false },
    });
    expect(broadcastDeleteActions(scheduled).delete.allowed).toBe(true);
    for (const status of ["completed", "paused"]) {
      expect(broadcastDeleteActions(broadcast(status, Date.now()))).toMatchObject({
        delete: { allowed: false },
        archive: { allowed: true },
      });
    }
  });

  it("allows neither while sending", () => {
    const sending = broadcastDeleteActions(broadcast("active", Date.now()));
    expect(sending.delete).toEqual({
      allowed: false,
      reason: "It's sending. Pause it first.",
    });
    expect(sending.archive.allowed).toBe(false);
  });
});
