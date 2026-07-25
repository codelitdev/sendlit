import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createSequence: vi.fn(),
    addMailToSequence: vi.fn(),
    updateMailInSequence: vi.fn(),
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
    createSequence: mocks.createSequence,
    addMailToSequence: mocks.addMailToSequence,
    countSequences: vi.fn(),
    deleteSequence: vi.fn(),
    deleteMailFromSequence: vi.fn(),
    getEmailSentCount: vi.fn(),
    getSequenceBySequenceId: vi.fn(),
    getSequenceClickThroughRate: vi.fn(),
    getSequenceOpenRate: vi.fn(),
    getSubscribers: vi.fn(),
    getSubscribersCount: vi.fn(),
    listSequences: vi.fn(),
    pauseSequence: vi.fn(),
    startSequence: vi.fn(),
    updateMailInSequence: mocks.updateMailInSequence,
    updateSequence: vi.fn(),
}));

import { requestApp } from "../test/http";
import sequenceRoutes from "./routes";

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(sequenceRoutes);
    return instance;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("marketing template route boundary", () => {
    it("rejects a transactional template during sequence creation", async () => {
        mocks.createSequence.mockRejectedValue(
            new Error("template_not_marketing"),
        );

        const response = await requestApp(app(), "/sequences", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "sequence",
                templateId: "tpl_transactional",
            }),
        });

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({ error: "template_not_marketing" });
    });

    it("rejects a transactional template when adding a sequence email", async () => {
        mocks.addMailToSequence.mockRejectedValue(
            new Error("template_not_marketing"),
        );

        const response = await requestApp(app(), "/sequences/seq_1/emails", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ templateId: "tpl_transactional" }),
        });

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({ error: "template_not_marketing" });
    });

    it("rejects a transactional template when changing a sequence email template", async () => {
        mocks.updateMailInSequence.mockRejectedValue(
            new Error("template_not_marketing"),
        );

        const response = await requestApp(
            app(),
            "/sequences/seq_1/emails/eml_1",
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ templateId: "tpl_transactional" }),
            },
        );

        expect(response.status).toBe(422);
        expect(response.json()).toEqual({ error: "template_not_marketing" });
    });
});
