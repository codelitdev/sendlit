import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { contacts, emailEvents } from "../db/schema";

const DAY_S = 86_400;
/** A click counts as much as an open this many days later: clicks are the
 * stronger signal, and opens are inflated by privacy proxies. */
const CLICK_BONUS_S = 14 * DAY_S;
/** Imported open/click rates stand for an open this recently (rate 1) to
 * this long ago (rate 0). */
const IMPORTED_WINDOW_S = 90 * DAY_S;
/** Contacts with no engagement rank by signup date, below anyone engaged in
 * the last half year. */
const NO_ENGAGEMENT_OFFSET_S = 180 * DAY_S;

const CHUNK = 1_000;

/** A rate from an imported column such as beehiiv's or Mailchimp's
 * `open_rate` (0.42, 42 or "42%"). */
function importedRate(
  fields: Record<string, unknown> | null,
  pattern: RegExp,
): number | null {
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!pattern.test(key)) continue;
    const raw =
      typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : "";
    const number = Number.parseFloat(raw.replace("%", ""));
    if (!Number.isFinite(number) || number < 0) continue;
    return Math.min(1, raw.includes("%") || number > 1 ? number / 100 : number);
  }
  return null;
}

/**
 * Orders contacts by engagement for sending: latest click (boosted), latest
 * open, imported open/click rates, then signup date. Returns a number per
 * contact id (seconds; higher is more engaged).
 */
export async function engagementPriorities(
  teamId: string,
  contactIds: string[],
  now = Date.now(),
): Promise<Map<string, number>> {
  const nowS = Math.floor(now / 1000);
  const priorities = new Map<string, number>();
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const ids = contactIds.slice(i, i + CHUNK);
    const [events, rows] = await Promise.all([
      db
        .select({
          contactId: emailEvents.contactId,
          lastClick: sql<
            string | null
          >`max(${emailEvents.createdAt}) filter (where ${emailEvents.action} = 'click')`,
          lastOpen: sql<
            string | null
          >`max(${emailEvents.createdAt}) filter (where ${emailEvents.action} = 'open')`,
        })
        .from(emailEvents)
        .where(and(eq(emailEvents.teamId, teamId), inArray(emailEvents.contactId, ids)))
        .groupBy(emailEvents.contactId),
      db
        .select({
          id: contacts.id,
          createdAt: contacts.createdAt,
          customFields: contacts.customFields,
        })
        .from(contacts)
        .where(inArray(contacts.id, ids)),
    ]);
    const byContact = new Map(events.map((event) => [event.contactId, event]));
    for (const contact of rows) {
      const event = byContact.get(contact.id);
      const seconds = (value: string | Date | null | undefined) =>
        value ? Math.floor(new Date(value).getTime() / 1000) : null;
      const fields = contact.customFields as Record<string, unknown> | null;
      const openRate = importedRate(fields, /open_?rate/i);
      const clickRate = importedRate(fields, /click_?rate/i);
      const candidates = [
        seconds(event?.lastClick) !== null
          ? seconds(event?.lastClick)! + CLICK_BONUS_S
          : null,
        seconds(event?.lastOpen),
        openRate !== null ? nowS - (1 - openRate) * IMPORTED_WINDOW_S : null,
        clickRate !== null
          ? nowS - (1 - clickRate) * IMPORTED_WINDOW_S + CLICK_BONUS_S
          : null,
        (seconds(contact.createdAt) ?? 0) - NO_ENGAGEMENT_OFFSET_S,
      ].filter((value): value is number => value !== null);
      priorities.set(contact.id, Math.round(Math.max(...candidates)));
    }
  }
  return priorities;
}
