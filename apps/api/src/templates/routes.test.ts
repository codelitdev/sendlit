import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";

const requestTeam = vi.hoisted(() => ({ id: "" }));

vi.mock("../db/client", async () => {
    const { makeTestDb } = await import("../test/db.js");
    return { db: await makeTestDb() };
});
vi.mock("../auth/middleware", () => ({
    requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../auth/require-team", () => ({
    requireTeam: (req: any, _res: any, next: () => void) => {
        req.teamId = requestTeam.id;
        next();
    },
}));
vi.mock("../observability/posthog", () => ({ captureEvent: vi.fn() }));

import { db } from "../db/client";
import { defaultEmailContent } from "../sequences/helpers";
import { emailTemplates } from "../db/schema";
import { seedTeamAndContact, truncateAll, type TestDb } from "../test/db";
import { requestApp } from "../test/http";
import { createTemplate } from "./queries";
import templateRoutes from "./routes";

const tdb = db as unknown as TestDb;

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(templateRoutes);
    return instance;
}

beforeEach(async () => {
    await truncateAll(tdb);
    vi.clearAllMocks();
});

describe("template purpose routes", () => {
    it("creates and filters team templates with computed requirements", async () => {
        const { team } = await seedTeamAndContact(tdb);
        requestTeam.id = team.id;

        const created = await requestApp(app(), "/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                title: "OTP",
                purpose: "transactional",
                content: {
                    ...defaultEmail,
                    content: [
                        {
                            blockType: "text",
                            settings: {
                                content: "Hello {{ customer.name }} {{ otp }}",
                            },
                        },
                    ],
                },
            }),
        });

        expect(created.status).toBe(201);
        expect(created.json()).toMatchObject({
            purpose: "transactional",
            requiredVariables: ["customer.name", "otp"],
        });

        await createTemplate({
            teamId: team.id,
            title: "Newsletter",
            purpose: "marketing",
            content: defaultEmailContent,
        });
        const filtered = await requestApp(
            app(),
            "/templates?purpose=transactional",
        );

        expect(filtered.status).toBe(200);
        expect(filtered.json()).toHaveLength(1);
        expect(filtered.json()[0]).toMatchObject({
            title: "OTP",
            purpose: "transactional",
        });
    });

    it("enforces footer structure and keeps purpose immutable", async () => {
        const { team } = await seedTeamAndContact(tdb);
        requestTeam.id = team.id;

        const invalid = await requestApp(app(), "/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                title: "Invalid marketing template",
                purpose: "marketing",
                content: defaultEmail,
            }),
        });
        expect(invalid.status).toBe(422);
        expect(invalid.json()).toEqual({ error: "footer_required" });

        const template = await createTemplate({
            teamId: team.id,
            title: "Newsletter",
            purpose: "marketing",
            content: defaultEmailContent,
        });
        const patched = await requestApp(
            app(),
            `/templates/${template.templateId}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ purpose: "transactional" }),
            },
        );

        expect(patched.status).toBe(200);
        expect(patched.json()).toMatchObject({ purpose: "marketing" });
    });

    it("duplicates within the source purpose with an empty request body", async () => {
        const { team } = await seedTeamAndContact(tdb);
        requestTeam.id = team.id;
        const template = await createTemplate({
            teamId: team.id,
            title: "Newsletter",
            purpose: "marketing",
            content: defaultEmailContent,
        });

        const duplicated = await requestApp(
            app(),
            `/templates/${template.templateId}/duplicate`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            },
        );

        expect(duplicated.status).toBe(201);
        expect(duplicated.json()).toMatchObject({
            title: "Newsletter (Copy)",
            purpose: "marketing",
            content: template.content,
        });
    });

    it("returns retired templates as invalid list items instead of a server error", async () => {
        const { team } = await seedTeamAndContact(tdb);
        requestTeam.id = team.id;
        await tdb.insert(emailTemplates).values({
            teamId: team.id,
            title: "Legacy campaign",
            purpose: "marketing",
            content: defaultEmail,
        });

        const response = await requestApp(app(), "/templates");

        expect(response.status).toBe(200);
        expect(response.json()).toEqual([
            expect.objectContaining({
                title: "Legacy campaign",
                validationError: "footer_required",
            }),
        ]);
    });

    it("returns a validation response rather than a server error for a retired template detail", async () => {
        const { team } = await seedTeamAndContact(tdb);
        requestTeam.id = team.id;
        const [legacy] = await tdb
            .insert(emailTemplates)
            .values({
                teamId: team.id,
                title: "Legacy campaign",
                purpose: "marketing",
                content: defaultEmail,
            })
            .returning();

        const response = await requestApp(
            app(),
            `/templates/${legacy.templateId}`,
        );

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({ error: "footer_required" });
    });

    it("filters built-in starters by purpose", async () => {
        const response = await requestApp(
            app(),
            "/system-templates?purpose=transactional",
        );

        expect(response.status).toBe(200);
        const items = response.json().items;
        expect(items).toHaveLength(9);
        expect(
            items.every(
                (template: any) => template.purpose === "transactional",
            ),
        ).toBe(true);
        expect(items[0]).toHaveProperty("requiredVariables");
    });
});
