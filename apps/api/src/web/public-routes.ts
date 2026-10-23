import { eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { JSDOM } from "jsdom";
import { db } from "../db/client";
import { signupForms } from "../db/schema";
import { captureError } from "../observability";
import { escapeHtml } from "../utils/html";
import {
  getHostedTeam,
  getIssue,
  type IssueSummary,
  issueSentAt,
  listIssues,
  listLiveIssueRows,
  toIssue,
  toSummary,
} from "./queries";
import { archiveUrl, issueUrl } from "./urls";

const router = Router();

const ISSUES_PER_PAGE = 20;

/** Team-authored email HTML is shown inline (so search engines index it),
 * with no scripts allowed and forms posting only back to SendLit. */
const PAGE_CSP = [
  "default-src 'none'",
  "img-src * data:",
  "style-src 'unsafe-inline' *",
  "font-src * data:",
  "form-action 'self'",
  "base-uri 'none'",
].join("; ");

const STYLE = `body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f6f7;color:#18181b}
.sl-wrap{max-width:44rem;margin:0 auto;padding:1.5rem 1rem}
.sl-bar{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.75rem 1rem;max-width:44rem;margin:0 auto}
.sl-bar a{color:#18181b;text-decoration:none;font-weight:600}
.sl-card{background:#fff;border:1px solid #e4e4e7;border-radius:.75rem;padding:1.5rem;margin-bottom:1rem}
.sl-card h1{font-size:1.75rem;margin:0 0 .5rem}.sl-card h2{font-size:1.125rem;margin:0 0 .25rem}
.sl-card h2 a{color:#18181b}.sl-muted{color:#71717a;font-size:.875rem;margin:0}
.sl-card p{line-height:1.6}
.sl-form{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
.sl-form input[type=email]{flex:1;min-width:12rem;padding:.625rem;border:1px solid #d4d4d8;border-radius:.5rem;font:inherit}
.sl-form button{font:inherit;padding:.625rem 1.25rem;border:0;border-radius:.5rem;background:#18181b;color:#fff;cursor:pointer}
.sl-hp{position:absolute;left:-9999px}
.sl-pages{display:flex;justify-content:space-between}.sl-pages a{color:#18181b}
.sl-issue{background:#fff;border:1px solid #e4e4e7;border-radius:.75rem;overflow:hidden}`;

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

function head({
  title,
  description,
  canonical,
  noindex,
  image,
  type,
  feed,
  extra = "",
}: {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  image?: string | null;
  type: "website" | "article";
  feed?: string;
  extra?: string;
}) {
  const meta = (attr: string, key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  return [
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description ? meta("name", "description", description) : "",
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    noindex ? '<meta name="robots" content="noindex">' : "",
    feed
      ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(feed)}">`
      : "",
    meta("property", "og:type", type),
    meta("property", "og:title", title),
    description ? meta("property", "og:description", description) : "",
    meta("property", "og:url", canonical),
    image ? meta("property", "og:image", image) : "",
    meta("name", "twitter:card", image ? "summary_large_image" : "summary"),
    meta("name", "twitter:title", title),
    description ? meta("name", "twitter:description", description) : "",
    image ? meta("name", "twitter:image", image) : "",
    extra,
  ].join("");
}

async function subscribeForm(signupFormId: string | null): Promise<string> {
  if (!signupFormId) return "";
  const [form] = await db
    .select({ formId: signupForms.formId })
    .from(signupForms)
    .where(eq(signupForms.id, signupFormId))
    .limit(1);
  if (!form) return "";
  return `<form class="sl-form" method="post" action="/f/${encodeURIComponent(form.formId)}"><input type="email" name="email" placeholder="you@example.com" required aria-label="Email"><input class="sl-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button type="submit">Subscribe</button></form>`;
}

/** Scripts, embeds and inline handlers can't run under the page's CSP
 * anyway; they're removed too so the markup a crawler sees is clean. */
function emailParts(html: string): { styles: string; body: string } {
  const document = new JSDOM(html).window.document;
  for (const element of document.querySelectorAll(
    "script, iframe, object, embed, base, meta[http-equiv], link[rel=import]",
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("on") ||
        (/^(href|src|action|formaction)$/i.test(attribute.name) &&
          /^\s*(javascript|vbscript|data:text\/html)/i.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const styles = [...document.querySelectorAll("style")]
    .map((style) => style.outerHTML)
    .join("");
  for (const style of document.body.querySelectorAll("style")) style.remove();
  return { styles, body: document.body.innerHTML };
}

function send(res: Response, html: string, noindex = false) {
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (noindex) res.setHeader("X-Robots-Tag", "noindex");
  res.type("html").send(html);
}

function notFound(res: Response) {
  res
    .status(404)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><style>${STYLE}</style></head><body><div class="sl-wrap"><div class="sl-card"><h1>Page not found</h1><p class="sl-muted">This issue isn't published, or the link is wrong.</p></div></div></body></html>`,
    );
}

// The team's archive: published issues, newest first, with a signup form.
router.get("/w/:handle", async (req: Request, res: Response) => {
  try {
    const hosted = await getHostedTeam(req.params.handle);
    if (!hosted) return notFound(res);
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const { items, total } = await listIssues(hosted.team.id, {
      offset: page,
      itemsPerPage: ISSUES_PER_PAGE,
    });
    const base = archiveUrl(hosted.settings)!;
    const title = hosted.settings.webTitle || hosted.team.name;
    const description = hosted.settings.webDescription || "";
    const list = items
      .map(
        (issue: IssueSummary) =>
          `<article class="sl-card"><h2><a href="${escapeHtml(issue.url ?? "#")}">${escapeHtml(issue.title)}</a></h2><p class="sl-muted"><time datetime="${issue.publishedAt}">${date(issue.publishedAt)}</time></p><p>${escapeHtml(issue.excerpt)}</p></article>`,
      )
      .join("");
    const pages = [
      page > 1 ? `<a href="${base}?page=${page - 1}">← Newer</a>` : "<span></span>",
      page * ISSUES_PER_PAGE < total
        ? `<a href="${base}?page=${page + 1}">Older →</a>`
        : "",
    ].join("");
    const html = `<!doctype html><html lang="en"><head>${head({
      title,
      description,
      canonical: page > 1 ? `${base}?page=${page}` : base,
      noindex: false,
      type: "website",
      feed: `${base}/feed.xml`,
    })}<style>${STYLE}</style></head><body><div class="sl-wrap"><header class="sl-card"><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}${await subscribeForm(hosted.settings.webSignupFormId)}</header>${list || '<p class="sl-muted">No issues yet.</p>'}<nav class="sl-pages">${pages}</nav><p class="sl-muted"><a href="${base}/feed.xml">RSS</a></p></div></body></html>`;
    send(res, html);
  } catch (error) {
    captureError({ error, source: "web.archive" });
    res.status(500).send("Something went wrong.");
  }
});

// One published issue.
router.get("/w/:handle/p/:slug", async (req: Request, res: Response) => {
  try {
    const hosted = await getHostedTeam(req.params.handle);
    if (!hosted) return notFound(res);
    const issue = await getIssue(hosted.team.id, req.params.slug);
    if (!issue) return notFound(res);
    const base = archiveUrl(hosted.settings)!;
    const pageUrl = issue.url ?? `${base}/p/${issue.slug}`;
    const title = issue.seoTitle || issue.title;
    const publisher = hosted.settings.webTitle || hosted.team.name;
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description: issue.excerpt,
      datePublished: issue.publishedAt,
      url: issue.canonicalUrl || pageUrl,
      mainEntityOfPage: issue.canonicalUrl || pageUrl,
      ...(issue.ogImage && { image: [issue.ogImage] }),
      author: { "@type": "Organization", name: publisher },
      publisher: { "@type": "Organization", name: publisher },
    }).replace(/</g, "\\u003c");
    const { styles, body } = emailParts(issue.html);
    const html = `<!doctype html><html lang="en"><head>${head({
      title: `${title} | ${publisher}`,
      description: issue.excerpt,
      canonical: issue.canonicalUrl || pageUrl,
      noindex: issue.noindex,
      image: issue.ogImage,
      type: "article",
      feed: `${base}/feed.xml`,
      extra: `<meta property="article:published_time" content="${issue.publishedAt}"><script type="application/ld+json">${jsonLd}</script>`,
    })}<style>${STYLE}</style>${styles}</head><body><nav class="sl-bar"><a href="${escapeHtml(base)}">${escapeHtml(publisher)}</a><span class="sl-muted"><time datetime="${issue.publishedAt}">${date(issue.publishedAt)}</time></span></nav><main class="sl-wrap"><h1 style="position:absolute;left:-9999px">${escapeHtml(issue.title)}</h1><div class="sl-issue">${body}</div><section class="sl-card" style="margin-top:1rem"><h2>Get the next issue by email</h2>${await subscribeForm(hosted.settings.webSignupFormId)}</section></main></body></html>`;
    send(res, html, issue.noindex);
  } catch (error) {
    captureError({ error, source: "web.issue" });
    res.status(500).send("Something went wrong.");
  }
});

const cdata = (value: string) =>
  `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// RSS 2.0 feed of the latest issues, with their full content.
router.get("/w/:handle/feed.xml", async (req: Request, res: Response) => {
  try {
    const hosted = await getHostedTeam(req.params.handle);
    if (!hosted) return notFound(res);
    const base = archiveUrl(hosted.settings)!;
    const rows = await listLiveIssueRows(hosted.team.id, 20);
    const entries = await Promise.all(
      rows.map(async (row) => {
        // One issue that fails to render shouldn't take the feed down.
        const { summary, html } = await toIssue(row, hosted.settings).catch(
          async (error) => {
            captureError({ error, source: "web.feed_item", severity: "warning" });
            return { summary: await toSummary(row, hosted.settings), html: "" };
          },
        );
        const link = summary.canonicalUrl || summary.url || `${base}/p/${summary.slug}`;
        return `<item><title>${xml(summary.title)}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid><pubDate>${new Date(summary.publishedAt).toUTCString()}</pubDate><description>${cdata(summary.excerpt)}</description>${html ? `<content:encoded>${cdata(emailParts(html).body)}</content:encoded>` : ""}</item>`;
      }),
    );
    const title = hosted.settings.webTitle || hosted.team.name;
    res.setHeader("Cache-Control", "public, max-age=300");
    res
      .type("application/rss+xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(title)}</title><link>${xml(base)}</link><atom:link href="${xml(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/><description>${xml(hosted.settings.webDescription || title)}</description>${entries.join("")}</channel></rss>`,
      );
  } catch (error) {
    captureError({ error, source: "web.feed" });
    res.status(500).send("Something went wrong.");
  }
});

// Sitemap of the archive and its indexable issues.
router.get("/w/:handle/sitemap.xml", async (req: Request, res: Response) => {
  try {
    const hosted = await getHostedTeam(req.params.handle);
    if (!hosted) return notFound(res);
    const base = archiveUrl(hosted.settings)!;
    const rows = await listLiveIssueRows(hosted.team.id, 5_000);
    const urls = rows
      // Pages that ask not to be indexed, or live elsewhere, stay out.
      .filter((row) => !row.webNoindex && !row.webCanonicalUrl)
      .map((row) => {
        const url = issueUrl(hosted.settings, row)!;
        const lastmod = (row.updatedAt ?? issueSentAt(row) ?? new Date()).toISOString();
        return `<url><loc>${xml(url)}</loc><lastmod>${lastmod}</lastmod></url>`;
      });
    res.setHeader("Cache-Control", "public, max-age=300");
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xml(base)}</loc></url>${urls.join("")}</urlset>`,
      );
  } catch (error) {
    captureError({ error, source: "web.sitemap" });
    res.status(500).send("Something went wrong.");
  }
});

export default router;
