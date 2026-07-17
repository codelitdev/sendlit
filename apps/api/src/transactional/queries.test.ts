import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});

// `createTransactionalEmail` enqueues a BullMQ job on every successful
// insert; the real queue would try to open a connection to Redis, which
// isn't available (or wanted) in this DB-backed query test.
vi.mock("../mail/queue", () => ({
    addTransactionalMailJob: vi.fn(),
}));

import { defaultEmail } from "@sendlit/email-editor";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { emailContent } from "../test/fixtures";
import { createTemplate } from "../templates/queries";
import { createEspConfig } from "../settings/esp/queries";
import { addOrStrengthenSuppression } from "../delivery-feedback/suppression-queries";
import {
    countTransactionalEmails,
    createTransactionalEmail,
    findTransactionalEmailByIdempotencyKey,
    getTransactionalEmailById,
    getTransactionalEmailByTxeId,
    incrementTransactionalEmailClickCount,
    incrementTransactionalEmailOpenCount,
    listTransactionalEmails,
    markTransactionalEmailBounced,
    markTransactionalEmailFailed,
    markTransactionalEmailSent,
    toPublicTransactionalEmail,
} from "./queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

describe("createTransactionalEmail validation", () => {
    it("rejects when neither templateId nor html is provided", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
            }),
        ).rejects.toThrow("invalid_content");
    });

    it("rejects when both templateId and html are provided", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                templateId: "tpl_whatever",
                html: "<p>hi</p>",
            }),
        ).rejects.toThrow("invalid_content");
    });

    it("rejects html sends that also carry non-empty variables", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                variables: { order_id: "123" },
            }),
        ).rejects.toThrow("invalid_content");
    });

    it("allows html sends with empty variables", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            variables: {},
        });
        expect(row.status).toBe("queued");
    });

    it("rejects headers containing CR/LF (header injection)", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                headers: { "X-Entity-Ref": "abc\r\nBcc: evil@example.com" },
            }),
        ).rejects.toThrow("invalid_headers");

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                headers: { "X-Bad\nName": "value" },
            }),
        ).rejects.toThrow("invalid_headers");
    });

    it("rejects pipeline-owned headers regardless of casing", async () => {
        const { team } = await seedTeamAndContact(tdb);
        for (const name of ["From", "tO", "SUBJECT", "content-type"]) {
            await expect(
                createTransactionalEmail({
                    teamId: team.id,
                    to: "a@example.com",
                    subject: "Hi",
                    html: "<p>hi</p>",
                    headers: { [name]: "spoofed" },
                }),
            ).rejects.toThrow("invalid_headers");
        }
    });

    it("accepts benign custom headers", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            headers: { "X-Entity-Ref": "order-1234" },
        });
        expect(row.headers).toEqual({ "X-Entity-Ref": "order-1234" });
    });

    it("maps a template render failure to render_failed", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: team.id,
            title: "Broken",
            content: emailContent({ text: "Hello {% broken" }),
        });

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                templateId: template.templateId,
            }),
        ).rejects.toThrow("render_failed");
    });
});

describe("createTransactionalEmail resolution errors", () => {
    it("throws template_not_found for a missing template", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                templateId: "tpl_missing",
            }),
        ).rejects.toThrow("template_not_found");
    });

    it("throws template_not_found for another team's template", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { team: otherTeam } = await seedTeamAndContact(tdb);
        const foreignTemplate = await createTemplate({
            teamId: otherTeam.id,
            title: "Foreign template",
            content: defaultEmail,
        });

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                templateId: foreignTemplate.templateId,
            }),
        ).rejects.toThrow("template_not_found");
    });

    it("throws esp_not_configured when the team has no ESP config", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await db
            .delete(schema.espConfigs)
            .where(eq(schema.espConfigs.teamId, team.id));

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
            }),
        ).rejects.toThrow("esp_not_configured");
    });

    it("rejects a suppressed recipient without creating a row or enqueuing", async () => {
        const { team } = await seedTeamAndContact(tdb);
        await addOrStrengthenSuppression({
            teamId: team.id,
            recipientEmail: "bounced@example.com",
            reason: "hard_bounce",
            actorType: "system",
        });

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "Bounced@Example.com",
                subject: "Hi",
                html: "<p>hi</p>",
            }),
        ).rejects.toThrow("recipient_suppressed");

        const rows = await db
            .select()
            .from(schema.transactionalEmails)
            .where(eq(schema.transactionalEmails.teamId, team.id));
        expect(rows).toHaveLength(0);
    });

    it("does not apply platform quota to a user-managed ESP", async () => {
        const { team } = await seedTeamAndContact(tdb, {
            account: { dailyMailLimit: 0 },
        });

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
            }),
        ).resolves.toMatchObject({ status: "queued" });
    });

    it("pins an explicitly selected ESP and rejects a foreign or missing espId", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const other = await seedTeamAndContact(tdb);
        const secondEsp = await createEspConfig(team.id, {
            name: "Marketing",
            provider: "smtp",
            host: "marketing.example.com",
            port: 587,
            secure: false,
            fromEmail: "marketing@example.com",
        });
        const foreignEsp = await createEspConfig(other.team.id, {
            name: "Other team's ESP",
            provider: "smtp",
            host: "other.example.com",
            port: 587,
            secure: false,
        });

        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            espId: secondEsp.espId,
        });
        expect(row.outboxId).toBe(secondEsp.id);
        expect(row.fromEmail).toContain("marketing@example.com");

        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                espId: foreignEsp.espId,
            }),
        ).rejects.toThrow("esp_not_found");
        await expect(
            createTransactionalEmail({
                teamId: team.id,
                to: "a@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                espId: "esp_does_not_exist",
            }),
        ).rejects.toThrow("esp_not_found");
    });
});

describe("createTransactionalEmail happy paths", () => {
    it("renders a template with variables and queues the send", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const template = await createTemplate({
            teamId: team.id,
            title: "Receipt",
            content: defaultEmail,
        });

        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "buyer@example.com",
            subject: "Your receipt",
            templateId: template.templateId,
            variables: { order_id: "42" },
        });

        expect(row.status).toBe("queued");
        expect(row.templateId).toBe(template.templateId);
        expect(row.toEmail).toBe("buyer@example.com");
        expect(row.html).toBeTruthy();
    });

    it("sends inline html verbatim, without a template", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "buyer@example.com",
            subject: "Your receipt",
            html: "<p>Hello {{ not_a_liquid_tag }}</p>",
        });

        expect(row.status).toBe("queued");
        expect(row.templateId).toBeNull();
        expect(row.html).toBe("<p>Hello {{ not_a_liquid_tag }}</p>");
    });

    it("associates the row with an existing contact by email, purely for analytics", async () => {
        const { team, contact } = await seedTeamAndContact(tdb);

        const row = await createTransactionalEmail({
            teamId: team.id,
            to: contact.email.toUpperCase(),
            subject: "Hi",
            html: "<p>hi</p>",
        });

        expect(row.contactId).toBe(contact.id);
        expect(row.toEmail).toBe(contact.email.toLowerCase());
    });

    it("delivers to an unsubscribed contact's address — never suppressed", async () => {
        const { team, contact } = await seedTeamAndContact(tdb, {
            contact: { subscribed: false },
        });

        const row = await createTransactionalEmail({
            teamId: team.id,
            to: contact.email,
            subject: "Password reset",
            html: "<p>Reset your password</p>",
        });

        expect(row.status).toBe("queued");
        expect(row.contactId).toBe(contact.id);
    });
});

describe("idempotency replay", () => {
    it("returns the same row for concurrent requests sharing an idempotency key", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const [a, b] = await Promise.all([
            createTransactionalEmail({
                teamId: team.id,
                to: "dup@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                idempotencyKey: "key-1",
            }),
            createTransactionalEmail({
                teamId: team.id,
                to: "dup@example.com",
                subject: "Hi",
                html: "<p>hi</p>",
                idempotencyKey: "key-1",
            }),
        ]);

        expect(a.txeId).toBe(b.txeId);
        expect(a.id).toBe(b.id);

        const rows = await db
            .select()
            .from(schema.transactionalEmails)
            .where(eq(schema.transactionalEmails.idempotencyKey, "key-1"));
        expect(rows).toHaveLength(1);
        const outbound = await db
            .select()
            .from(schema.outboundMessages)
            .where(eq(schema.outboundMessages.transactionalEmailId, a.id));
        expect(outbound).toHaveLength(1);
    });

    it("returns the original row on a sequential replay without re-enqueuing", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const first = await createTransactionalEmail({
            teamId: team.id,
            to: "dup@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            idempotencyKey: "key-2",
        });
        const second = await createTransactionalEmail({
            teamId: team.id,
            to: "dup@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            idempotencyKey: "key-2",
        });

        expect(second.txeId).toBe(first.txeId);

        const found = await findTransactionalEmailByIdempotencyKey(
            team.id,
            "key-2",
        );
        expect(found?.txeId).toBe(first.txeId);
    });
});

describe("lookups, listing and mark* transitions", () => {
    it("looks up by txeId and internal id", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
        });

        expect((await getTransactionalEmailByTxeId(row.txeId))?.id).toBe(
            row.id,
        );
        expect((await getTransactionalEmailById(row.id))?.txeId).toBe(
            row.txeId,
        );
        expect(await getTransactionalEmailByTxeId("txe_missing")).toBeNull();
        expect(await getTransactionalEmailById(crypto.randomUUID())).toBeNull();
    });

    it("lists and counts scoped to the team, filtered by status and time range", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const { team: otherTeam } = await seedTeamAndContact(tdb);

        const first = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "First",
            html: "<p>first</p>",
        });
        const second = await createTransactionalEmail({
            teamId: team.id,
            to: "b@example.com",
            subject: "Second",
            html: "<p>second</p>",
        });
        await createTransactionalEmail({
            teamId: otherTeam.id,
            to: "c@example.com",
            subject: "Other team",
            html: "<p>other</p>",
        });

        await markTransactionalEmailSent(second.id);

        const all = await listTransactionalEmails({ teamId: team.id });
        expect(all.map((r) => r.id).sort()).toEqual(
            [first.id, second.id].sort(),
        );
        expect(await countTransactionalEmails(team.id)).toBe(2);

        const sentOnly = await listTransactionalEmails({
            teamId: team.id,
            status: "sent",
        });
        expect(sentOnly).toHaveLength(1);
        expect(sentOnly[0]?.id).toBe(second.id);
        expect(
            await countTransactionalEmails(team.id, { status: "sent" }),
        ).toBe(1);

        const future = Date.now() + 60_000;
        expect(
            await countTransactionalEmails(team.id, {
                createdAfter: future,
            }),
        ).toBe(0);
        expect(
            await countTransactionalEmails(team.id, {
                createdBefore: future,
            }),
        ).toBe(2);
    });

    it("paginates via offset/rowsPerPage, most recent first", async () => {
        const { team } = await seedTeamAndContact(tdb);
        for (let i = 0; i < 3; i++) {
            await createTransactionalEmail({
                teamId: team.id,
                to: `paged-${i}@example.com`,
                subject: `Subject ${i}`,
                html: `<p>${i}</p>`,
            });
        }

        const page1 = await listTransactionalEmails({
            teamId: team.id,
            offset: 1,
            rowsPerPage: 2,
        });
        const page2 = await listTransactionalEmails({
            teamId: team.id,
            offset: 2,
            rowsPerPage: 2,
        });

        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(1);
        expect(page1.map((r) => r.id)).not.toContain(page2[0]?.id);
    });

    it("moves a queued row through sent/failed/bounced transitions", async () => {
        const { team } = await seedTeamAndContact(tdb);

        const sentRow = await createTransactionalEmail({
            teamId: team.id,
            to: "sent@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
        });
        const sent = await markTransactionalEmailSent(sentRow.id);
        expect(sent?.status).toBe("sent");
        expect(sent?.sentAt).toBeInstanceOf(Date);

        const failedRow = await createTransactionalEmail({
            teamId: team.id,
            to: "failed@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
        });
        const failed = await markTransactionalEmailFailed(
            failedRow.id,
            "SMTP timeout",
        );
        expect(failed?.status).toBe("failed");
        expect(failed?.error).toBe("SMTP timeout");

        const bouncedRow = await createTransactionalEmail({
            teamId: team.id,
            to: "bounced@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
        });
        const bounced = await markTransactionalEmailBounced(
            bouncedRow.id,
            "550 mailbox not found",
        );
        expect(bounced?.status).toBe("bounced");
        expect(bounced?.error).toBe("550 mailbox not found");

        expect(
            await markTransactionalEmailSent(crypto.randomUUID()),
        ).toBeNull();
    });

    it("increments open/click counts independently", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
            trackOpens: true,
            trackClicks: true,
        });

        await incrementTransactionalEmailOpenCount(row.txeId);
        await incrementTransactionalEmailOpenCount(row.txeId);
        await incrementTransactionalEmailClickCount(row.txeId);

        const updated = await getTransactionalEmailByTxeId(row.txeId);
        expect(updated?.openCount).toBe(2);
        expect(updated?.clickCount).toBe(1);
    });
});

describe("toPublicTransactionalEmail", () => {
    it("renames fields and omits html unless includeHtml is set", async () => {
        const { team } = await seedTeamAndContact(tdb);
        const row = await createTransactionalEmail({
            teamId: team.id,
            to: "a@example.com",
            subject: "Hi",
            html: "<p>hi</p>",
        });

        const withoutHtml = toPublicTransactionalEmail(row, {
            includeHtml: false,
        });
        expect(withoutHtml).toMatchObject({
            txeId: row.txeId,
            to: row.toEmail,
            from: row.fromEmail,
            status: row.status,
        });
        expect(withoutHtml).not.toHaveProperty("html");

        const withHtml = toPublicTransactionalEmail(row, {
            includeHtml: true,
        });
        expect(withHtml).toMatchObject({ html: row.html });
    });
});
