import type { CustomFields } from "@sendlit/api-contract";
import { and, asc, gt } from "drizzle-orm";
import type { SuppressionReason } from "../config/constants";
import { db } from "../db/client";
import { contacts } from "../db/schema";
import { getActiveSuppressionReasons } from "../delivery-feedback/suppression-queries";
import { normalizeEmail } from "../utils/email";
import { type Contact, listContactsConditions } from "./queries";
import type { ContactFilterWithAggregator } from "./segment";

const PAGE_SIZE = 1000;

/** Quotes a CSV cell (RFC 4180) and defuses spreadsheet formulas: a cell
 * starting with = + - @ or a tab/CR is prefixed with `'` (OWASP CSV
 * injection guidance). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportStatus(contact: Contact, reason: SuppressionReason | undefined) {
  if (reason === "complaint") return "complained";
  if (reason && reason !== "manual") return "bounced";
  return contact.subscribed && !reason ? "subscribed" : "unsubscribed";
}

function customFieldCell(value: CustomFields[string] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/**
 * Every contact of the team, or those matching `filter`, as CSV: email,
 * name, status, tags, created_at, suppression_reason, then one column per
 * custom field. The header names round-trip through the contact importer.
 */
export async function exportContactsCsv({
  teamId,
  filter,
}: {
  teamId: string;
  filter?: ContactFilterWithAggregator[];
}): Promise<{ csv: string; count: number }> {
  const rows: { contact: Contact; reason?: SuppressionReason }[] = [];
  let lastId: string | undefined;
  while (true) {
    const page = await db
      .select()
      .from(contacts)
      .where(
        and(
          listContactsConditions({ teamId, filter }),
          lastId ? gt(contacts.id, lastId) : undefined,
        ),
      )
      .orderBy(asc(contacts.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) break;
    const reasons = await getActiveSuppressionReasons(
      teamId,
      page.map((contact) => contact.email),
    );
    for (const contact of page) {
      rows.push({ contact, reason: reasons.get(normalizeEmail(contact.email)) });
    }
    lastId = page.at(-1)?.id;
    if (page.length < PAGE_SIZE) break;
  }

  const customFieldKeys = [
    ...new Set(
      rows.flatMap(({ contact }) => Object.keys(contact.customFields as CustomFields)),
    ),
  ].sort();
  const header = [
    "email",
    "name",
    "status",
    "tags",
    "created_at",
    "suppression_reason",
    ...customFieldKeys,
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const { contact, reason } of rows) {
    const customFields = contact.customFields as CustomFields;
    lines.push(
      [
        contact.email,
        contact.name,
        exportStatus(contact, reason),
        contact.tags.join(", "),
        contact.createdAt?.toISOString(),
        reason,
        ...customFieldKeys.map((key) => customFieldCell(customFields[key])),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
}
