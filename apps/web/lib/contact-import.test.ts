import { describe, expect, it } from "bun:test";
import { toImportRows } from "./contact-import";

const csv = (headers: string[], rows: Record<string, string>[]) => ({
  fileName: "export.csv",
  headers,
  rows,
});

describe("toImportRows", () => {
  it("gives every row the file's status when there is no status column", () => {
    const file = csv(
      ["Email Address", "First Name"],
      [{ "Email Address": "a@example.com", "First Name": "Ann" }],
    );
    const mapping = { "Email Address": "email", "First Name": "first_name" } as const;
    expect(toImportRows(file, mapping, "unsubscribed")).toEqual([
      { row: 2, email: "a@example.com", name: "Ann", status: "unsubscribed" },
    ]);
    expect(toImportRows(file, mapping, "bounced")[0].status).toBe("bounced");
    expect(toImportRows(file, mapping)[0]).not.toHaveProperty("status");
  });

  it("reads Mailchimp's quoted tags", () => {
    const file = csv(
      ["Email Address", "TAGS"],
      [{ "Email Address": "a@example.com", TAGS: '"Early access","VIP"' }],
    );
    expect(
      toImportRows(file, { "Email Address": "email", TAGS: "tags" })[0].tags,
    ).toEqual(["Early access", "VIP"]);
  });

  it("uses the status column when there is one", () => {
    const file = csv(
      ["email", "status", "tier"],
      [{ email: "a@example.com", status: "Paused", tier: "premium" }],
    );
    const mapping = {
      email: "email",
      status: "status",
      tier: "tag_from_value",
    } as const;
    expect(toImportRows(file, mapping, "unsubscribed")).toEqual([
      { row: 2, email: "a@example.com", status: "Paused", tags: ["tier:premium"] },
    ]);
  });
});
