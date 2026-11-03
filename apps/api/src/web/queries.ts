import type { WebIssue, WebPublishing, WebSettings } from "@sendlit/api-contract";
import { and, count, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { TEST_UNSUBSCRIBE_TOKEN } from "../config/constants";
import { db } from "../db/client";
import { sequenceEmails, sequences, settings, signupForms, teams } from "../db/schema";
import { createForm } from "../forms/queries";
import { renderCampaignHtml } from "../mail/campaign";
import { getTeamSettingsRow, type TeamSettings } from "../settings/general/queries";
import { archiveUrl, issueUrl } from "./urls";

type Sequence = typeof sequences.$inferSelect;

export class WebPublishingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    code: string,
  ) {
    super(code);
  }
}

/** Lowercase, dash-separated, ASCII. */
export function slugify(text: string, maxLength = 80): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

/** `base`, or `base-2`, `base-3`, ... when taken. */
async function firstFree(base: string, taken: (candidate: string) => Promise<boolean>) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
}

/** Sent broadcasts published to the web: the issues anyone can read.
 * Archived broadcasts leave the archive, its feed and sitemap (#147). */
const liveIssue = (teamId: string) =>
  and(
    eq(sequences.teamId, teamId),
    eq(sequences.type, "broadcast"),
    eq(sequences.webPublished, true),
    isNotNull(sequences.webSlug),
    isNull(sequences.archivedAt),
    sql`${sequences.report}->'broadcast'->>'lockedAt' IS NOT NULL`,
  );

const sentAt = (sequence: Sequence): Date | null => {
  const lockedAt = (
    sequence.report as { broadcast?: { lockedAt?: number | null } } | null
  )?.broadcast?.lockedAt;
  return lockedAt ? new Date(Number(lockedAt)) : null;
};

// ---------------------------------------------------------------- settings

async function publicFormId(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [form] = await db
    .select({ formId: signupForms.formId })
    .from(signupForms)
    .where(eq(signupForms.id, id))
    .limit(1);
  return form?.formId ?? null;
}

export async function toWebSettings(row: TeamSettings | null): Promise<WebSettings> {
  const archive = archiveUrl(row);
  return {
    enabled: row?.webEnabled ?? false,
    handle: row?.webHandle ?? null,
    title: row?.webTitle ?? null,
    description: row?.webDescription ?? null,
    signupFormId: await publicFormId(row?.webSignupFormId ?? null),
    archiveUrl: archive,
    rssUrl: archive ? `${archive}/feed.xml` : null,
  };
}

export async function getWebSettings(teamId: string): Promise<WebSettings> {
  return toWebSettings(await getTeamSettingsRow(teamId));
}

export async function updateWebSettings(
  teamId: string,
  input: {
    enabled?: boolean;
    handle?: string;
    title?: string | null;
    description?: string | null;
    signupFormId?: string | null;
  },
): Promise<WebSettings> {
  const existing = await getTeamSettingsRow(teamId);
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const values: Partial<typeof settings.$inferInsert> = { updatedAt: new Date() };
  if (input.enabled !== undefined) values.webEnabled = input.enabled;
  if (input.title !== undefined) values.webTitle = input.title || null;
  if (input.description !== undefined)
    values.webDescription = input.description || null;

  const handleTaken = async (handle: string) => {
    const [row] = await db
      .select({ teamId: settings.teamId })
      .from(settings)
      .where(and(eq(settings.webHandle, handle), ne(settings.teamId, teamId)))
      .limit(1);
    return Boolean(row);
  };
  if (input.handle !== undefined) {
    if (await handleTaken(input.handle))
      throw new WebPublishingError(409, "handle_taken");
    values.webHandle = input.handle;
  }

  if (input.signupFormId !== undefined) {
    if (input.signupFormId === null) {
      values.webSignupFormId = null;
    } else {
      const [form] = await db
        .select({ id: signupForms.id })
        .from(signupForms)
        .where(
          and(
            eq(signupForms.teamId, teamId),
            eq(signupForms.formId, input.signupFormId),
          ),
        )
        .limit(1);
      if (!form) throw new WebPublishingError(400, "signup_form_not_found");
      values.webSignupFormId = form.id;
    }
  }

  // Turning hosting on fills in what the archive needs.
  const enabling = values.webEnabled ?? existing?.webEnabled ?? false;
  if (enabling) {
    if (!(values.webHandle ?? existing?.webHandle)) {
      values.webHandle = await firstFree(
        slugify(team?.name ?? "", 40) || "newsletter",
        handleTaken,
      );
    }
    if (input.signupFormId === undefined && !existing?.webSignupFormId) {
      const form = await createForm(teamId, {
        name: "Web archive",
        tags: ["web-archive"],
      });
      values.webSignupFormId = form.id;
    }
  }

  let row: TeamSettings;
  try {
    [row] = existing
      ? await db
          .update(settings)
          .set(values)
          .where(eq(settings.teamId, teamId))
          .returning()
      : await db
          .insert(settings)
          .values({ teamId, ...values })
          .returning();
  } catch (error: any) {
    // Another team claimed the handle at the same moment.
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      throw new WebPublishingError(409, "handle_taken");
    }
    throw error;
  }
  return toWebSettings(row);
}

// --------------------------------------------------------------- publishing

export async function toWebPublishing(
  sequence: Sequence,
  settingsRow?: TeamSettings | null,
): Promise<WebPublishing> {
  const row =
    settingsRow === undefined ? await getTeamSettingsRow(sequence.teamId) : settingsRow;
  const sent = sentAt(sequence);
  return {
    published: sequence.webPublished,
    slug: sequence.webSlug,
    seoTitle: sequence.webSeoTitle,
    seoDescription: sequence.webSeoDescription,
    ogImage: sequence.webOgImage,
    noindex: sequence.webNoindex,
    canonicalUrl: sequence.webCanonicalUrl,
    live: Boolean(
      sequence.webPublished && sequence.webSlug && sent && !sequence.archivedAt,
    ),
    publishedAt: sequence.webPublished && sent ? sent.toISOString() : null,
    url: issueUrl(row, sequence),
  };
}

export async function updateWebPublishing(
  sequence: Sequence,
  input: {
    published?: boolean;
    slug?: string;
    seoTitle?: string | null;
    seoDescription?: string | null;
    ogImage?: string | null;
    noindex?: boolean;
    canonicalUrl?: string | null;
  },
): Promise<WebPublishing> {
  if (sequence.type !== "broadcast") {
    throw new WebPublishingError(400, "only_broadcasts_can_be_published");
  }
  const slugTaken = async (slug: string) => {
    const [row] = await db
      .select({ id: sequences.id })
      .from(sequences)
      .where(
        and(
          eq(sequences.teamId, sequence.teamId),
          eq(sequences.webSlug, slug),
          ne(sequences.id, sequence.id),
        ),
      )
      .limit(1);
    return Boolean(row);
  };
  const values: Partial<typeof sequences.$inferInsert> = { updatedAt: new Date() };
  if (input.slug !== undefined) {
    if (await slugTaken(input.slug)) throw new WebPublishingError(409, "slug_taken");
    values.webSlug = input.slug;
  }
  if (input.published !== undefined) values.webPublished = input.published;
  if (input.seoTitle !== undefined) values.webSeoTitle = input.seoTitle || null;
  if (input.seoDescription !== undefined) {
    values.webSeoDescription = input.seoDescription || null;
  }
  if (input.ogImage !== undefined) values.webOgImage = input.ogImage || null;
  if (input.noindex !== undefined) values.webNoindex = input.noindex;
  if (input.canonicalUrl !== undefined)
    values.webCanonicalUrl = input.canonicalUrl || null;
  // A slug, once given, stays, so links keep working.
  if (
    (values.webPublished ?? sequence.webPublished) &&
    !(values.webSlug ?? sequence.webSlug)
  ) {
    values.webSlug = await firstFree(slugify(sequence.title) || "issue", slugTaken);
  }

  try {
    const [row] = await db
      .update(sequences)
      .set(values)
      .where(eq(sequences.id, sequence.id))
      .returning();
    return toWebPublishing(row);
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      throw new WebPublishingError(409, "slug_taken");
    }
    throw error;
  }
}

// ------------------------------------------------------------------ issues

async function broadcastEmail(sequence: Sequence) {
  const emails = await db
    .select()
    .from(sequenceEmails)
    .where(eq(sequenceEmails.sequenceId, sequence.id));
  return (
    emails.find((email) => email.emailId === sequence.emailsOrder[0]) ??
    emails[0] ??
    null
  );
}

/** The issue as a web page: the email with nobody's data in it, no tracking
 * and no unsubscribe link. */
export async function renderIssueHtml(sequence: Sequence): Promise<string | null> {
  const email = await broadcastEmail(sequence);
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, sequence.teamId))
    .limit(1);
  if (!email || !team) return null;
  return renderCampaignHtml({
    team,
    content: email.content,
    subscriber: { email: "", name: null, tags: [] },
    ids: { contactId: "", sequenceId: sequence.sequenceId, emailId: email.emailId },
    unsubscribeToken: TEST_UNSUBSCRIBE_TOKEN,
    web: "public",
    publication: sequence,
  });
}

/** A short plain-text preview from the email's text blocks: no footer,
 * merge tags or markdown. */
export function excerptOf(content: unknown, length = 240): string {
  const blocks = (
    content as { content?: { blockType?: string; settings?: { content?: unknown } }[] }
  )?.content;
  const text = (Array.isArray(blocks) ? blocks : [])
    .filter(
      (block) =>
        block.blockType === "text" && typeof block.settings?.content === "string",
    )
    .map((block) => block.settings!.content as string)
    .join(" ")
    .replace(/{{-?[\s\S]*?-?}}|{%-?[\s\S]*?-?%}/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

export type IssueSummary = Omit<WebIssue, "html">;

async function toSummary(
  sequence: Sequence,
  row: TeamSettings | null,
  email?: Awaited<ReturnType<typeof broadcastEmail>>,
): Promise<IssueSummary> {
  const content = (email === undefined ? await broadcastEmail(sequence) : email)
    ?.content;
  return {
    slug: sequence.webSlug ?? "",
    title: sequence.title,
    publishedAt: (sentAt(sequence) ?? new Date()).toISOString(),
    excerpt: sequence.webSeoDescription || excerptOf(content),
    seoTitle: sequence.webSeoTitle,
    seoDescription: sequence.webSeoDescription,
    ogImage: sequence.webOgImage,
    noindex: sequence.webNoindex,
    canonicalUrl: sequence.webCanonicalUrl,
    url: issueUrl(row, sequence),
  };
}

async function toIssue(sequence: Sequence, row: TeamSettings | null) {
  const [summary, html] = await Promise.all([
    toSummary(sequence, row),
    renderIssueHtml(sequence),
  ]);
  return { summary, html: html ?? "" };
}

/** Live issues, newest first, without rendering them. */
export function listLiveIssueRows(teamId: string, limit: number, offset = 0) {
  return db
    .select()
    .from(sequences)
    .where(liveIssue(teamId))
    .orderBy(desc(sql`(${sequences.report}->'broadcast'->>'lockedAt')::bigint`))
    .limit(limit)
    .offset(offset);
}

export { sentAt as issueSentAt, toIssue, toSummary };

export async function listIssues(
  teamId: string,
  { offset = 1, itemsPerPage = 20 }: { offset?: number; itemsPerPage?: number } = {},
): Promise<{ items: IssueSummary[]; total: number }> {
  const [rows, [{ total }], row] = await Promise.all([
    listLiveIssueRows(teamId, itemsPerPage, (offset - 1) * itemsPerPage),
    db.select({ total: count() }).from(sequences).where(liveIssue(teamId)),
    getTeamSettingsRow(teamId),
  ]);
  const items = await Promise.all(rows.map((sequence) => toSummary(sequence, row)));
  return { items, total: Number(total) };
}

export async function getIssue(teamId: string, slug: string): Promise<WebIssue | null> {
  const [sequence] = await db
    .select()
    .from(sequences)
    .where(and(liveIssue(teamId), eq(sequences.webSlug, slug)))
    .limit(1);
  if (!sequence) return null;
  const { summary, html } = await toIssue(sequence, await getTeamSettingsRow(teamId));
  return { ...summary, html };
}

/** A team whose hosted pages are on, by its handle. */
export async function getHostedTeam(handle: string) {
  const [row] = await db
    .select({ settings, team: teams })
    .from(settings)
    .innerJoin(teams, eq(teams.id, settings.teamId))
    .where(and(eq(settings.webHandle, handle), eq(settings.webEnabled, true)))
    .limit(1);
  if (!row || row.team.status === "archived") return null;
  return row;
}
