import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const { sequenceEmails, sequences, signupForms } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { emailContent, seedSequence } = await import("../test/fixtures");
const { requestApp } = await import("../test/http");
const { renderCampaignHtml } = await import("../mail/campaign");
const {
  excerptOf,
  getIssue,
  listIssues,
  slugify,
  toWebPublishing,
  updateWebPublishing,
  updateWebSettings,
  WebPublishingError,
} = await import("./queries");
const { default: publicRoutes } = await import("./public-routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(publicRoutes);
  return instance;
}

beforeEach(async () => {
  await truncateAll(tdb);
});

async function seedBroadcast(teamId: string, title: string, sent = true) {
  const { sequenceRow } = await seedSequence(tdb, {
    teamId,
    type: "broadcast",
    report: sent ? { broadcast: { lockedAt: Date.now(), sentAt: null } } : {},
    emails: [{ emailId: `email_${crypto.randomUUID().slice(0, 8)}` }],
  });
  const [row] = await tdb
    .update(sequences)
    .set({ title })
    .where(eq(sequences.id, sequenceRow.id))
    .returning();
  return row;
}

async function setup(teamName = "Acme Weekly") {
  const seeded = await seedTeamAndContact(tdb, { team: { name: teamName } });
  const settings = await updateWebSettings(seeded.team.id, { enabled: true });
  return { ...seeded, settings };
}

describe("web publishing", () => {
  it("makes excerpts from the text blocks only", () => {
    expect(
      excerptOf({
        content: [
          {
            blockType: "text",
            settings: {
              content:
                "# Big news\n\nHi {{ subscriber.name }}, read **[this](https://x.y)** _now_.",
            },
          },
          { blockType: "footer", settings: { content: "1 Test St" } },
        ],
      }),
    ).toBe("Big news Hi, read this now.");
    expect(
      excerptOf({
        content: [{ blockType: "text", settings: { content: "a ".repeat(200) } }],
      }),
    ).toHaveLength(240);
  });

  it("slugifies titles", () => {
    expect(slugify("  Héllo, World! Issue #12 ")).toBe("hello-world-issue-12");
    expect(slugify("!!!")).toBe("");
  });

  it("turning hosting on picks a unique handle and creates the archive's signup form", async () => {
    const first = await setup();
    expect(first.settings).toMatchObject({ enabled: true, handle: "acme-weekly" });
    expect(first.settings.archiveUrl).toEndWith("/w/acme-weekly");
    expect(first.settings.rssUrl).toEndWith("/w/acme-weekly/feed.xml");
    const [form] = await tdb
      .select()
      .from(signupForms)
      .where(eq(signupForms.formId, first.settings.signupFormId!));
    expect(form).toMatchObject({ teamId: first.team.id, name: "Web archive" });

    const second = await setup("Acme Weekly");
    expect(second.settings.handle).toBe("acme-weekly-2");
    await expect(
      updateWebSettings(second.team.id, { handle: "acme-weekly" }),
    ).rejects.toMatchObject({ status: 409, message: "handle_taken" });
    await expect(
      updateWebSettings(second.team.id, { signupFormId: first.settings.signupFormId }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("publishes broadcasts only, with a stable, unique slug", async () => {
    const { team } = await setup();
    const one = await seedBroadcast(team.id, "Issue One");
    const two = await seedBroadcast(team.id, "Issue One");

    const published = await updateWebPublishing(one, { published: true });
    expect(published).toMatchObject({ published: true, slug: "issue-one", live: true });
    expect(published.url).toEndWith("/w/acme-weekly/p/issue-one");
    expect((await updateWebPublishing(two, { published: true })).slug).toBe(
      "issue-one-2",
    );
    await expect(
      updateWebPublishing(two, { slug: "issue-one" }),
    ).rejects.toBeInstanceOf(WebPublishingError);

    // Unpublishing keeps the slug for when it comes back.
    const [row] = await tdb.select().from(sequences).where(eq(sequences.id, one.id));
    const off = await updateWebPublishing(row, { published: false });
    expect(off).toMatchObject({ published: false, slug: "issue-one", live: false });

    const { sequenceRow: drip } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_drip" }],
    });
    await expect(updateWebPublishing(drip, { published: true })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("lists only published issues that were sent, newest first", async () => {
    const { team } = await setup();
    const sent = await seedBroadcast(team.id, "Sent issue");
    const draft = await seedBroadcast(team.id, "Draft issue", false);
    const hidden = await seedBroadcast(team.id, "Not published");
    await updateWebPublishing(sent, {
      published: true,
      seoDescription: "All about it",
    });
    await updateWebPublishing(draft, { published: true });
    expect((await toWebPublishing({ ...draft, webPublished: true })).live).toBe(false);

    const { items, total } = await listIssues(team.id);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ slug: "sent-issue", excerpt: "All about it" });
    expect(await getIssue(team.id, "draft-issue")).toBeNull();
    expect(hidden.webPublished).toBe(false);
  });

  it("renders the issue with nobody's data, no tracking and no unsubscribe link", async () => {
    const { team } = await setup();
    const issue = await seedBroadcast(team.id, "Clean");
    await updateWebPublishing(issue, { published: true });

    const { html } = (await getIssue(team.id, "clean"))!;
    expect(html).toContain("Hello !");
    expect(html).not.toContain("/track/");
    expect(html).not.toContain("/unsubscribe");
    expect(html).not.toContain("sendlit.invalid");
    expect(html).not.toContain("/view/");
    expect(html).toContain("https://example.com/offer");
  });

  it("{{ web_version_url }} links sent emails to the public page once published", async () => {
    const { team } = await setup();
    const issue = await seedBroadcast(team.id, "Linked");
    const render = async (sequence: typeof issue) =>
      renderCampaignHtml({
        team,
        content: emailContent({ text: "Read it online: {{ web_version_url }}" }),
        subscriber: { email: "a@example.com", name: "Ann", tags: [] },
        ids: { contactId: "c", sequenceId: sequence.sequenceId, emailId: "e" },
        unsubscribeToken: "tok",
        publication: sequence,
      });
    // Not published yet: the reader's own web version.
    expect(await render(issue)).toMatch(
      /Read it online: https:\/\/sendlit\.test\/view\//,
    );
    await updateWebPublishing(issue, { published: true });
    const [published] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, issue.id));
    const html = await render(published);
    expect(html).toContain(
      "Read it online: https://sendlit.test/w/acme-weekly/p/linked",
    );
    // On the public page itself it's the page's own URL.
    await tdb
      .update(sequenceEmails)
      .set({ content: emailContent({ text: "Online: {{ web_version_url }}" }) })
      .where(eq(sequenceEmails.sequenceId, issue.id));
    expect((await getIssue(team.id, "linked"))!.html).toContain(
      "Online: https://sendlit.test/w/acme-weekly/p/linked",
    );
  });
});

describe("public web pages", () => {
  it("serves the archive, issue pages with SEO tags, RSS and sitemap", async () => {
    const { team, settings } = await setup();
    const first = await seedBroadcast(team.id, "First <issue>");
    const hidden = await seedBroadcast(team.id, "Hidden");
    const external = await seedBroadcast(team.id, "Elsewhere");
    await updateWebPublishing(first, {
      published: true,
      ogImage: "https://example.com/og.png",
    });
    await updateWebPublishing(hidden, { published: true, noindex: true });
    await updateWebPublishing(external, {
      published: true,
      canonicalUrl: "https://blog.example.com/elsewhere",
    });

    const archive = await requestApp(app(), "/w/acme-weekly");
    expect(archive.status).toBe(200);
    expect(archive.body).toContain("First &lt;issue&gt;");
    expect(archive.body).toContain(`action="/f/${settings.signupFormId}"`);
    expect(archive.body).toContain('type="application/rss+xml"');
    expect(archive.headers["content-security-policy"]).toContain("default-src 'none'");

    const page = await requestApp(app(), "/w/acme-weekly/p/first-issue");
    expect(page.status).toBe(200);
    expect(page.body).toContain(
      '<link rel="canonical" href="https://sendlit.test/w/acme-weekly/p/first-issue">',
    );
    expect(page.body).toContain(
      'property="og:image" content="https://example.com/og.png"',
    );
    expect(page.body).toContain('name="twitter:card" content="summary_large_image"');
    expect(page.body).toContain('"@type":"Article"');
    expect(page.body).not.toContain('content="noindex"');

    const noindex = await requestApp(app(), "/w/acme-weekly/p/hidden");
    expect(noindex.body).toContain('<meta name="robots" content="noindex">');
    expect(noindex.headers["x-robots-tag"]).toBe("noindex");
    const canonical = await requestApp(app(), "/w/acme-weekly/p/elsewhere");
    expect(canonical.body).toContain('href="https://blog.example.com/elsewhere"');

    const feed = await requestApp(app(), "/w/acme-weekly/feed.xml");
    expect(feed.headers["content-type"]).toContain("application/rss+xml");
    expect(feed.body).toContain("<title>First &lt;issue&gt;</title>");
    expect(feed.body).toContain("<content:encoded>");

    const sitemap = await requestApp(app(), "/w/acme-weekly/sitemap.xml");
    expect(sitemap.body).toContain("/w/acme-weekly/p/first-issue");
    expect(sitemap.body).not.toContain("/p/hidden");
    expect(sitemap.body).not.toContain("/p/elsewhere");
  });

  it("takes archived broadcasts off the archive, feed and sitemap until restored", async () => {
    const { team } = await setup();
    const kept = await seedBroadcast(team.id, "Kept");
    const archived = await seedBroadcast(team.id, "Archived issue");
    await updateWebPublishing(kept, { published: true });
    await updateWebPublishing(archived, { published: true });
    const setArchived = (archivedAt: Date | null) =>
      tdb.update(sequences).set({ archivedAt }).where(eq(sequences.id, archived.id));

    await setArchived(new Date());
    const archive = await requestApp(app(), "/w/acme-weekly");
    expect(archive.body).toContain("Kept");
    expect(archive.body).not.toContain("Archived issue");
    expect((await requestApp(app(), "/w/acme-weekly/p/archived-issue")).status).toBe(
      404,
    );
    expect((await requestApp(app(), "/w/acme-weekly/feed.xml")).body).not.toContain(
      "Archived issue",
    );
    expect((await requestApp(app(), "/w/acme-weekly/sitemap.xml")).body).not.toContain(
      "/p/archived-issue",
    );
    expect((await listIssues(team.id)).total).toBe(1);
    const [row] = await tdb
      .select()
      .from(sequences)
      .where(eq(sequences.id, archived.id));
    expect((await toWebPublishing(row)).live).toBe(false);

    await setArchived(null);
    expect((await requestApp(app(), "/w/acme-weekly/p/archived-issue")).status).toBe(
      200,
    );
    expect((await listIssues(team.id)).total).toBe(2);
  });

  it("404s unpublished issues, and everything once hosting is off", async () => {
    const { team } = await setup();
    const issue = await seedBroadcast(team.id, "Gone");
    const published = await updateWebPublishing(issue, { published: true });
    expect((await requestApp(app(), "/w/acme-weekly/p/gone")).status).toBe(200);

    const [row] = await tdb.select().from(sequences).where(eq(sequences.id, issue.id));
    await updateWebPublishing(row, { published: false });
    expect((await requestApp(app(), "/w/acme-weekly/p/gone")).status).toBe(404);
    expect((await requestApp(app(), "/w/acme-weekly/feed.xml")).body).not.toContain(
      "Gone",
    );
    expect((await requestApp(app(), "/w/acme-weekly/sitemap.xml")).body).not.toContain(
      "/p/gone",
    );
    expect(published.slug).toBe("gone");

    await updateWebSettings(team.id, { enabled: false });
    expect((await requestApp(app(), "/w/acme-weekly")).status).toBe(404);
    // Platforms still get the issues through the API.
    expect((await listIssues(team.id)).total).toBe(0);
  });
});
