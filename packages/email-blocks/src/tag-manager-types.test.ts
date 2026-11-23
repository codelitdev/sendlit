import { describe, expect, it } from "bun:test";
import type * as Contract from "@sendlit/api-contract";
import type * as Local from "./tag-manager-types";

/** Compiles only when A and B are mutually assignable. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const matches = <T extends true>(value: T) => value;

describe("tag manager types", () => {
  it("match the API contract", () => {
    // `bun run typecheck` fails here if the published shapes drift.
    expect(matches<Same<Local.TagSummary, Contract.TagSummary>>(true)).toBe(true);
    expect(matches<Same<Local.TagReferences, Contract.TagReferences>>(true)).toBe(true);
    expect(matches<Same<Local.RenameTagResult, Contract.RenameTagResult>>(true)).toBe(
      true,
    );
    expect(matches<Same<Local.DeleteTagResult, Contract.DeleteTagResult>>(true)).toBe(
      true,
    );
  });
});
