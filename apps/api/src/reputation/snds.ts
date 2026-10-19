/** Hosts that serve SNDS automated data access links. The link carries the
 * access key, and SendLit fetches it server-side, so only these hosts are
 * accepted. `SNDS_ALLOWED_HOSTS` adds more (tests, proxies). */
const DEFAULT_HOSTS = [
  "substrate.office.com",
  "sendersupport.olc.protection.outlook.com",
];

const extraHosts = () =>
  (process.env.SNDS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

export class SndsLinkError extends Error {}

/** Checks that a pasted link is an SNDS data link SendLit may fetch. */
export function validateSndsUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SndsLinkError("snds_link_invalid");
  }
  const microsoft = url.protocol === "https:" && DEFAULT_HOSTS.includes(url.hostname);
  const extra = extraHosts().includes(url.host);
  if ((!microsoft && !extra) || url.username || url.password) {
    throw new SndsLinkError("snds_link_invalid");
  }
  return url.toString();
}

export type SndsDay = {
  filterResult: "green" | "yellow" | "red" | null;
  complaintRate: number | null;
  complaintRateText: string | null;
  trapHits: number | null;
  recipients: number | null;
};

/** One CSV line, honouring quoted fields. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** SNDS's IP data export: no header row, one line per IP and day:
 * IP, activity start, activity end, RCPT commands, DATA commands, message
 * recipients, filter result, complaint rate, trap message start, trap
 * message end, trap hits, sample HELO, sample MAIL FROM, comments. A header
 * row, if present, is used to find the columns instead. */
const POSITIONS = {
  ip: 0,
  start: 1,
  recipients: 5,
  filter: 6,
  complaint: 7,
  trapHits: 10,
};

function columnsFromHeader(header: string[]): typeof POSITIONS | null {
  const find = (pattern: RegExp) => header.findIndex((name) => pattern.test(name));
  const columns = {
    ip: find(/^ip/i),
    start: find(/activity.*start|^start/i),
    recipients: find(/recipient/i),
    filter: find(/filter/i),
    complaint: find(/complaint/i),
    trapHits: find(/trap.*hit/i),
  };
  return columns.ip >= 0 && columns.start >= 0 && columns.filter >= 0 ? columns : null;
}

/** `10/18/2026 12:00 AM` (SNDS uses US dates in UTC) or ISO, as `YYYY-MM-DD`. */
function dayOf(value: string): string | null {
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const integer = (value: string | undefined) => {
  const number = Number.parseInt((value ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(number) ? number : null;
};

/** Parses SNDS IP data into `{ ip: { day: data } }`. Throws when the text
 * isn't SNDS data at all (an error page, an expired link). */
export function parseSndsData(text: string): Record<string, Record<string, SndsDay>> {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};
  if (/<html|<!doctype/i.test(lines[0])) throw new SndsLinkError("snds_link_invalid");
  const first = csvFields(lines[0]);
  const header = IPV4.test(first[0]) ? null : columnsFromHeader(first);
  if (!IPV4.test(first[0]) && !header) throw new SndsLinkError("snds_link_invalid");
  const columns = header ?? POSITIONS;
  const result: Record<string, Record<string, SndsDay>> = {};
  for (const line of header ? lines.slice(1) : lines) {
    const fields = csvFields(line);
    const ip = fields[columns.ip];
    const day = dayOf(fields[columns.start] ?? "");
    if (!ip || !IPV4.test(ip) || !day) continue;
    const filter = (fields[columns.filter] ?? "").toLowerCase();
    const complaintText =
      columns.complaint >= 0 ? fields[columns.complaint] || null : null;
    const below = complaintText?.startsWith("<");
    const percent = Number.parseFloat((complaintText ?? "").replace(/[^\d.]/g, ""));
    result[ip] ??= {};
    result[ip][day] = {
      filterResult:
        filter === "green" || filter === "yellow" || filter === "red" ? filter : null,
      complaintRate: !below && Number.isFinite(percent) ? percent / 100 : null,
      complaintRateText: complaintText,
      trapHits: columns.trapHits >= 0 ? integer(fields[columns.trapHits]) : null,
      recipients: columns.recipients >= 0 ? integer(fields[columns.recipients]) : null,
    };
  }
  return result;
}

export async function fetchSndsData(url: string) {
  const response = await fetch(validateSndsUrl(url), {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  // Expired keys answer with an error page or a redirect to sign in.
  if (!response.ok) throw new SndsLinkError("snds_link_expired");
  return parseSndsData(await response.text());
}
