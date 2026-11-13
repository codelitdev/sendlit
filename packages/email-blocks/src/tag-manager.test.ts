import { describe, expect, it } from "bun:test";
import {
  deleteNotice,
  listCounts,
  plural,
  referenceCount,
  renameNotice,
} from "./tag-manager-text";

describe("tag manager text", () => {
  it("pluralises counts", () => {
    expect(plural(1, "contact")).toBe("1 contact");
    expect(plural(2500, "contact")).toBe("2,500 contacts");
    expect(plural(2, "broadcast or sequence", "broadcasts or sequences")).toBe(
      "2 broadcasts or sequences",
    );
  });

  it("lists the non-zero counts", () => {
    expect(listCounts([[0, "contact"]])).toBe("nothing");
    expect(
      listCounts([
        [3, "contact"],
        [0, "segment"],
      ]),
    ).toBe("3 contacts");
    expect(
      listCounts([
        [3, "contact"],
        [1, "segment"],
        [2, "signup form"],
      ]),
    ).toBe("3 contacts, 1 segment and 2 signup forms");
  });

  it("describes a rename and a delete", () => {
    expect(
      renameNotice({
        tag: "vip",
        previousTag: "VIP",
        contactsUpdated: 4,
        segmentsUpdated: 1,
        sequencesUpdated: 0,
        signupFormsUpdated: 0,
      }),
    ).toBe("Renamed VIP to vip on 4 contacts and 1 segment.");
    expect(
      deleteNotice({
        tag: "old",
        contactsUpdated: 1,
        references: {
          tag: "old",
          contactCount: 0,
          segments: [],
          sequences: [],
          signupForms: [],
        },
      }),
    ).toBe("Deleted old from 1 contact.");
  });

  it("counts places that still name the tag", () => {
    expect(
      referenceCount({
        tag: "old",
        contactCount: 3,
        segments: [{ segmentId: "s1", name: "Buyers" }],
        sequences: [
          {
            sequenceId: "q1",
            title: "Welcome",
            type: "sequence",
            status: "active",
            usages: ["trigger"],
          },
        ],
        signupForms: [],
      }),
    ).toBe(2);
  });
});
