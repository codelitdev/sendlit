import { describe, expect, it } from "bun:test";
import { sequenceStatsMetrics } from "./sequence-stats";

const stats = {
  sent: 10,
  openRate: 0.5,
  clickThroughRate: 0.123,
  subscribersCount: 12,
};

describe("sequenceStatsMetrics", () => {
  it("formats counts and rates", () => {
    expect(
      sequenceStatsMetrics(stats).map(({ label, value }) => [label, value]),
    ).toEqual([
      ["Sent", 10],
      ["Recipients", 12],
      ["Open rate", "50%"],
      ["Click rate", "12%"],
    ]);
  });

  it("adds waiting contacts and deliverability rates when known", () => {
    const labels = sequenceStatsMetrics(
      { ...stats, bounceRate: 0.015, complaintRate: 0.0004 },
      3,
    ).map(({ label, value }) => [label, value]);
    expect(labels).toContainEqual(["Waiting", 3]);
    expect(labels).toContainEqual(["Bounce rate", "1.5%"]);
    expect(labels).toContainEqual(["Spam complaints", "0.04%"]);
  });

  it("mentions the 100-email minimum before sending pauses", () => {
    const metrics = sequenceStatsMetrics({ ...stats, bounceRate: 0, complaintRate: 0 });
    for (const label of ["Bounce rate", "Spam complaints"]) {
      expect(metrics.find((m) => m.label === label)?.helpText).toContain(
        "once 100 emails have gone out",
      );
    }
  });

  it("opens the recipients behind a rate only when it is above zero", () => {
    const onViewBounced = () => {};
    const onViewComplained = () => {};
    const metrics = sequenceStatsMetrics(
      { ...stats, bounceRate: 0.05, complaintRate: 0 },
      undefined,
      { onViewBounced, onViewComplained },
    );
    expect(metrics.find((m) => m.label === "Bounce rate")?.onSelect).toBe(
      onViewBounced,
    );
    expect(
      metrics.find((m) => m.label === "Spam complaints")?.onSelect,
    ).toBeUndefined();
  });
});
