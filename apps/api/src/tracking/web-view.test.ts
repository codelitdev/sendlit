import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;
const { seedSequence } = await import("../test/fixtures");
const { requestApp } = await import("../test/http");
const { TEST_CONTACT_ID } = await import("../config/constants");
const { getCampaignViewUrl } = await import("../mail/campaign");
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
