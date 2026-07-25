import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createTransactionalEmail: vi.fn(),
}));

vi.mock("../auth/middleware", () => ({
    requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../auth/require-team", () => ({
    requireTeam: (req: any, _res: any, next: () => void) => {
        req.teamId = "team-1";
        next();
    },
}));
vi.mock("./queries", () => ({
    createTransactionalEmail: mocks.createTransactionalEmail,
    getTransactionalEmailByTxeId: vi.fn(),
    listTransactionalEmails: vi.fn(),
    countTransactionalEmails: vi.fn(),
    toPublicTransactionalEmail: vi.fn(),
}));

import { MissingTemplateVariablesError } from "../mail/render";
import { requestApp } from "../test/http";
import transactionalRoutes from "./routes";

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(transactionalRoutes);
    return instance;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("transactional template route errors", () => {
    it("returns the stable purpose mismatch response", async () => {
        mocks.createTransactionalEmail.mockRejectedValue(
            new Error("template_not_transactional"),
        );

        const response = await requestApp(app(), "/emails", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                to: "reader@example.com",
                subject: "Hello",
                templateId: "tpl_marketing",
            }),
        });

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({
            error: "template_not_transactional",
        });
    });

    it("returns sorted missing paths without accepting the send", async () => {
        mocks.createTransactionalEmail.mockRejectedValue(
            new MissingTemplateVariablesError(["customer.name", "otp"]),
        );

        const response = await requestApp(app(), "/emails", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                to: "reader@example.com",
                subject: "Hello",
                templateId: "tpl_transactional",
            }),
        });

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({
            error: "missing_template_variables",
            missingVariables: ["customer.name", "otp"],
        });
    });

    it("rejects caller-controlled marketing variables", async () => {
        mocks.createTransactionalEmail.mockRejectedValue(
            new Error("marketing_variables_not_allowed"),
        );

        const response = await requestApp(app(), "/emails", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                to: "reader@example.com",
                subject: "Hello",
                templateId: "tpl_transactional",
                variables: { address: "Caller controlled" },
            }),
        });

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({
            error: "marketing_variables_not_allowed",
        });
    });
});
