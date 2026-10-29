import { beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { emailContent, seedSequence } = await import("../test/fixtures");
const { sequenceEmails, sequences } = await import("../db/schema");
const { getOrCreateContentVersion } = await import("../sequences/content-versions");
const { requestApp } = await import("../test/http");
const { TEST_CONTACT_ID } = await import("../config/constants");
const { getCampaignViewUrl, renderCampaignHtml } = await import("../mail/campaign");
const { generatePixelToken } = await import("../utils/pixel-jwt");
const { default: webViewRoutes } = await import("./web-view");

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(webViewRoutes);
  return instance;
}

const pathOf = (url: string) => new URL(url).pathname;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("GET /view/:token", () => {
  it("renders the recipient's web version without tracking, in a sandbox", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });

    const response = await requestApp(
      app(),
      pathOf(
        getCampaignViewUrl({
          contactId: contact.contactId,
          sequenceId: sequenceRow.sequenceId,
          emailId: emailRows[0].emailId,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain("Hello Ada Lovelace!");
    expect(response.body).toContain(`/unsubscribe/${contact.unsubscribeToken}`);
    expect(response.body).toContain('href="https://example.com/offer"');
    expect(response.body).not.toContain("/track/");
    expect(String(response.headers["content-security-policy"])).toContain("sandbox");
    expect(response.headers["x-robots-tag"]).toBe("noindex");
  });

  it("renders a test send's link without anyone's data", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });

    const response = await requestApp(
      app(),
      pathOf(
        getCampaignViewUrl({
          contactId: TEST_CONTACT_ID,
          sequenceId: sequenceRow.sequenceId,
          emailId: emailRows[0].emailId,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain("/unsubscribe/test");
  });

  it("shows the version that was sent, not later edits", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const ids = {
      contactId: contact.contactId,
      sequenceId: sequenceRow.sequenceId,
      emailId: emailRows[0].emailId,
    };
    const sent = await getOrCreateContentVersion({ ...emailRows[0], teamId: team.id });
    await tdb
      .update(sequenceEmails)
      .set({ content: emailContent({ text: "Edited after sending" }) })
      .where(eq(sequenceEmails.id, emailRows[0].id));

    const versioned = await requestApp(
      app(),
      pathOf(getCampaignViewUrl({ ...ids, versionId: sent.versionId })),
    );
    expect(versioned.status).toBe(200);
    expect(versioned.body).toContain("Hello Ada Lovelace!");
    expect(versioned.body).not.toContain("Edited after sending");

    // Links sent before versions existed show the current content.
    const legacy = await requestApp(app(), pathOf(getCampaignViewUrl(ids)));
    expect(legacy.status).toBe(200);
    expect(legacy.body).toContain("Edited after sending");
  });

  it("404s once the sequence has view in browser turned off", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const path = pathOf(
      getCampaignViewUrl({
        contactId: contact.contactId,
        sequenceId: sequenceRow.sequenceId,
        emailId: emailRows[0].emailId,
      }),
    );
    expect((await requestApp(app(), path)).status).toBe(200);

    await tdb
      .update(sequences)
      .set({ viewInBrowser: false })
      .where(eq(sequences.id, sequenceRow.id));
    expect((await requestApp(app(), path)).status).toBe(404);
  });

  it("404s a version that belongs to another email", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }, { emailId: "email_e2" }],
    });
    const other = await getOrCreateContentVersion({ ...emailRows[1], teamId: team.id });

    const response = await requestApp(
      app(),
      pathOf(
        getCampaignViewUrl({
          contactId: contact.contactId,
          sequenceId: sequenceRow.sequenceId,
          emailId: emailRows[0].emailId,
          versionId: other.versionId,
        }),
      ),
    );
    expect(response.status).toBe(404);
  });

  it("404s tampered tokens, tracking tokens and other teams' contacts", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const other = await seedTeamAndContact(tdb);
    const { sequenceRow, emailRows } = await seedSequence(tdb, {
      teamId: team.id,
      emails: [{ emailId: "email_e1" }],
    });
    const ids = {
      contactId: other.contact.contactId,
      sequenceId: sequenceRow.sequenceId,
      emailId: emailRows[0].emailId,
    };

    expect((await requestApp(app(), pathOf(getCampaignViewUrl(ids)))).status).toBe(404);
    expect((await requestApp(app(), "/view/not-a-token")).status).toBe(404);
    // An open-pixel token carries the same ids but isn't a view token.
    expect((await requestApp(app(), `/view/${generatePixelToken(ids)}`)).status).toBe(
      404,
    );
  });
});

describe("renderCampaignHtml", () => {
  it("leaves the view in browser link out when it's turned off", async () => {
    const { team, contact } = await seedTeamAndContact(tdb);
    const render = (viewInBrowser?: boolean) =>
      renderCampaignHtml({
        team,
        content: emailContent({ text: "Online: [{{ view_in_browser_url }}]" }),
        subscriber: { email: contact.email, name: contact.name, tags: [] },
        ids: { contactId: contact.contactId, sequenceId: "seq_s", emailId: "email_e" },
        unsubscribeToken: contact.unsubscribeToken,
        viewInBrowser,
      });

    const on = await render();
    expect(on).toContain("View in browser");
    expect(on).toMatch(/Online: \[https?:\/\/[^\]]+\/view\//);

    const off = await render(false);
    expect(off).not.toContain("View in browser");
    expect(off).not.toContain("/view/");
    expect(off).toContain("Online: []");
    expect(off).toContain("/unsubscribe/");
  });
});
