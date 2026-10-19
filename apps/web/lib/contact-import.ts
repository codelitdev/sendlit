import {
  type ContactImportField,
  type ContactImportStatus,
  normalizeImportHeader,
} from "@sendlit/api-contract";
import type { ImportContactRow } from "@/lib/api";

export interface ParsedCsv {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/** Builds the API rows from the CSV rows and the chosen column mapping. */
export function toImportRows(
  csv: ParsedCsv,
  mapping: Record<string, ContactImportField>,
  /** Every row's status, for files without a status column. */
  fileStatus: ContactImportStatus = "subscribed",
): ImportContactRow[] {
  const columns = (field: ContactImportField) =>
    csv.headers.filter((header) => mapping[header] === field);
  const [emailColumn] = columns("email");
  const hasStatusColumn = columns("status").length > 0;
  return csv.rows.map((record, index) => {
    const value = (header: string) => record[header]?.trim() ?? "";
    const first = (field: ContactImportField) =>
      columns(field)
        .map(value)
        .find((v) => v) || undefined;
    const name =
      first("name") ||
      [first("first_name"), first("last_name")].filter(Boolean).join(" ") ||
      undefined;
    const tags = [
      ...columns("tags").flatMap((header) => value(header).split(/[,;]/)),
      ...columns("tag_from_value")
        .filter((header) => value(header))
        .map((header) => `${normalizeImportHeader(header)}:${value(header)}`),
    ]
      // Mailchimp quotes each tag: "Tag A","Tag B".
      .map((tag) =>
        tag
          .trim()
          .replace(/^"(.*)"$/, "$1")
          .trim(),
      )
      .filter(Boolean);
    const customFields = Object.fromEntries(
      columns("custom_field")
        .filter((header) => value(header))
        .map((header) => [normalizeImportHeader(header), value(header)]),
    );
    return {
      // The header is line 1, so data row 0 is line 2 of the file.
      row: index + 2,
      email: value(emailColumn),
      ...(name && { name }),
      ...(tags.length > 0 && { tags }),
      ...(hasStatusColumn
        ? first("status") !== undefined && { status: first("status") }
        : fileStatus !== "subscribed" && { status: fileStatus }),
      ...(first("created_at") && { createdAt: first("created_at") }),
      ...(Object.keys(customFields).length > 0 && { customFields }),
    };
  });
}
