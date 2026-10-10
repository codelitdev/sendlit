import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../mail/send", () => ({
    sendMail: vi
        .fn()
        .mockResolvedValue({ messageId: null, providerResponse: null }),
}));

import { db } from "../db/client";
import { sendMail } from "../mail/send";
import { contacts, emailEvents } from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { seedOngoingSequence, seedSequence } from "../test/fixtures";
import { requestApp } from "../test/http";
import { processOngoingSequence } from "../automation/process-ongoing-sequence";
import trackingRoutes from "./routes";

/**
 * End-to-end over the real database: send a sequence email, pull the pixel,
 * click and unsubscribe URLs out of the HTML handed to the transport, and
 * request them against the API's tracking router the way a mail client would.
 */

const tdb = db as unknown as TestDb;
const mockedSendMail = vi.mocked(sendMail);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(trackingRoutes);

function linksIn(html: string) {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) =>
        m[1].replace(/&amp;/g, "&"),
    );
    const find = (path: string) => {
        const url = urls.find((u) =>
            new URL(u, "x:/").pathname.startsWith(path),
        );
        if (!url) throw new Error(`no ${path} link in the sent email`);
        return new URL(url);
    };
    return {
        pixel: find("/track/open"),
        click: find("/track/click"),
        unsubscribe: find("/unsubscribe/"),
    };
}

async function sendSequenceEmail() {
    const seeded = await seedTeamAndContact(tdb);
    const { sequenceRow } = await seedSequence(tdb, {
        teamId: seeded.team.id,
        emails: [{ emailId: "email_e1" }],
    });
    const row = await seedOngoingSequence(tdb, {
        teamId: seeded.team.id,
        sequenceId: sequenceRow.id,
        contactId: seeded.contact.id,
    });
    await processOngoingSequence(row.id);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    const { html } = mockedSendMail.mock.calls[0][0];
    return { ...seeded, links: linksIn(html) };
}

const pathOf = (url: URL) => `${url.pathname}${url.search}`;

async function isSubscribed(contactId: string) {
    const [row] = await tdb
        .select({ subscribed: contacts.subscribed })
        .from(contacts)
        .where(eq(contacts.id, contactId));
    return row.subscribed;
}

async function eventsFor(contactId: string) {
    return tdb
        .select()
        .from(emailEvents)
        .where(eq(emailEvents.contactId, contactId));
}

beforeEach(async () => {
    await truncateAll(tdb);
    mockedSendMail.mockClear();
});

describe("tracking links in delivered mail", () => {
    it("point at the API's own /track routes", async () => {
        const { links } = await sendSequenceEmail();

        for (const url of [links.pixel, links.click]) {
            expect(url.origin).toBe("https://sendlit.test");
            expect(url.pathname).toMatch(/^\/track\/(open|click)$/);
        }
    });

    it("records an open when the embedded pixel is fetched", async () => {
        const { contact, links } = await sendSequenceEmail();

        const response = await requestApp(app, pathOf(links.pixel));

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("image/gif");
        await vi.waitFor(async () =>
            expect(await eventsFor(contact.id)).toEqual([
                expect.objectContaining({ action: "open" }),
            ]),
        );
    });

    it("records a click and redirects to the original destination", async () => {
        const { contact, links } = await sendSequenceEmail();

        const response = await requestApp(app, pathOf(links.click));

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("https://example.com/offer");
        expect(await eventsFor(contact.id)).toEqual([
            expect.objectContaining({
                action: "click",
                link: "https://example.com/offer",
            }),
        ]);
    });

    it("still serves links in the legacy /api/track form", async () => {
        const { contact, links } = await sendSequenceEmail();

        const open = await requestApp(app, `/api${pathOf(links.pixel)}`);
        const click = await requestApp(app, `/api${pathOf(links.click)}`);

        expect(open.status).toBe(200);
        expect(click.status).toBe(302);
        await vi.waitFor(async () =>
            expect(
                (await eventsFor(contact.id)).map((e) => e.action).sort(),
            ).toEqual(["click", "open"]),
        );
    });
});

describe("unsubscribe link in delivered mail", () => {
    it("does not unsubscribe on GET or HEAD (link scanners, prefetching)", async () => {
        const { contact, links } = await sendSequenceEmail();

        const get = await requestApp(app, links.unsubscribe.pathname);
        const head = await requestApp(app, links.unsubscribe.pathname, {
            method: "HEAD",
        });

        expect(get.status).toBe(200);
        expect(get.body).toContain('<form method="post">');
        expect(get.body).toContain(contact.email);
        expect(head.status).toBe(200);
        expect(await isSubscribed(contact.id)).toBe(true);
    });

    it("unsubscribes when the confirmation form is submitted", async () => {
        const { contact, links } = await sendSequenceEmail();

        const response = await requestApp(app, links.unsubscribe.pathname, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "source=page",
        });

        expect(response.status).toBe(200);
        expect(response.body).toContain("You have been unsubscribed");
        expect(await isSubscribed(contact.id)).toBe(false);

        const revisit = await requestApp(app, links.unsubscribe.pathname);
        expect(revisit.body).toContain("You have been unsubscribed");
        expect(revisit.body).not.toContain("<form");
    });

    it("accepts an RFC 8058 one-click POST from a mailbox provider", async () => {
        const { contact, links } = await sendSequenceEmail();

        const first = await requestApp(app, links.unsubscribe.pathname, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
        });
        const repeat = await requestApp(app, links.unsubscribe.pathname, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
        });

        expect(first.status).toBe(200);
        expect(first.body).toBe("");
        expect(repeat.status).toBe(200);
        expect(await isSubscribed(contact.id)).toBe(false);
    });

    it("rejects an unknown token without touching any contact", async () => {
        const { contact } = await sendSequenceEmail();

        const get = await requestApp(app, "/unsubscribe/not-a-token");
        const post = await requestApp(app, "/unsubscribe/not-a-token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "source=page",
        });

        expect(get.status).toBe(404);
        expect(post.status).toBe(404);
        expect(await isSubscribed(contact.id)).toBe(true);
    });

    it("escapes the contact's address in the confirmation page", async () => {
        const seeded = await seedTeamAndContact(tdb, {
            contact: { email: `"<b>x</b>"@example.com` },
        });

        const response = await requestApp(
            app,
            `/unsubscribe/${seeded.contact.unsubscribeToken}`,
        );

        expect(response.body).not.toContain("<b>x</b>");
        expect(response.body).toContain("&lt;b&gt;x&lt;/b&gt;");
    });
});
