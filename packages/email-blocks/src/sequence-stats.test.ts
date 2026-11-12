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
});
