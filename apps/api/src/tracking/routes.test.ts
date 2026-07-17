import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    verifyPixelToken: vi.fn(),
    insertValues: vi.fn(),
    getContactByContactId: vi.fn(),
    getContactByUnsubscribeToken: vi.fn(),
    updateContact: vi.fn(),
    getSequenceEmailByEmailId: vi.fn(),
    getSequenceRowBySequenceId: vi.fn(),
    incrementOpen: vi.fn(),
    incrementClick: vi.fn(),
    captureEvent: vi.fn(),
    captureError: vi.fn(),
}));

vi.mock("../db/client", () => ({
    db: { insert: vi.fn(() => ({ values: mocks.insertValues })) },
}));
vi.mock("../utils/pixel-jwt", () => ({
    verifyPixelToken: mocks.verifyPixelToken,
}));
vi.mock("../contacts/queries", () => ({
    getContactByContactId: mocks.getContactByContactId,
    getContactByUnsubscribeToken: mocks.getContactByUnsubscribeToken,
    updateContact: mocks.updateContact,
}));
vi.mock("../sequences/queries", () => ({
    getSequenceEmailByEmailId: mocks.getSequenceEmailByEmailId,
}));
vi.mock("../automation/queries", () => ({
    getSequenceRowBySequenceId: mocks.getSequenceRowBySequenceId,
}));
vi.mock("../transactional/queries", () => ({
    incrementTransactionalEmailOpenCount: mocks.incrementOpen,
    incrementTransactionalEmailClickCount: mocks.incrementClick,
}));
vi.mock("../observability/posthog", () => ({
    captureEvent: mocks.captureEvent,
    captureError: mocks.captureError,
}));
vi.mock("../services/log", () => ({
    default: { error: vi.fn() },
}));

import trackingRoutes from "./routes";

type TestResponse = {
    status: number;
    body: Buffer;
    headers: Record<string, string | number | string[] | undefined>;
};

async function get(path: string): Promise<TestResponse> {
    const app = express();
    app.use(trackingRoutes);

    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = path;
    req.headers = { host: "localhost:5000" };

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const done = new Promise<TestResponse>((resolve) => {
        res.write = ((chunk: any, ...args: any[]) => {
            if (chunk) chunks.push(Buffer.from(chunk));
            args.find((arg) => typeof arg === "function")?.();
            return true;
        }) as typeof res.write;
        res.end = ((chunk: any, ...args: any[]) => {
            if (chunk) chunks.push(Buffer.from(chunk));
            args.find((arg) => typeof arg === "function")?.();
            resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks),
                headers: res.getHeaders(),
            });
            return res;
        }) as typeof res.end;
    });

    (app as any).handle(req, res);
    req.push(null);
    return done;
}

function campaignPayload() {
    return {
        contactId: "cnt_public",
        sequenceId: "seq_public",
        emailId: "email_public",
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.updateContact.mockResolvedValue(undefined);
    mocks.incrementOpen.mockResolvedValue(undefined);
    mocks.incrementClick.mockResolvedValue(undefined);
    mocks.getContactByContactId.mockResolvedValue({
        id: "contact-internal",
        contactId: "cnt_public",
        teamId: "team-internal",
    });
    mocks.getSequenceRowBySequenceId.mockResolvedValue({
        id: "sequence-internal",
    });
    mocks.getSequenceEmailByEmailId.mockResolvedValue({ id: "email-internal" });
});

describe("tracking and unsubscribe routes", () => {
    it("always returns the tracking GIF for an invalid open token", async () => {
        mocks.verifyPixelToken.mockReturnValue(null);

        const response = await get("/track/open?d=invalid");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("image/gif");
        expect(response.body.subarray(0, 3).toString()).toBe("GIF");
        expect(mocks.insertValues).not.toHaveBeenCalled();
    });

    it("records a campaign open using resolved internal foreign keys", async () => {
        mocks.verifyPixelToken.mockReturnValue(campaignPayload());

        const response = await get("/track/open?d=valid");
        await vi.waitFor(() => expect(mocks.insertValues).toHaveBeenCalled());

        expect(response.status).toBe(200);
        expect(mocks.getSequenceRowBySequenceId).toHaveBeenCalledWith(
            "team-internal",
            "seq_public",
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-internal",
                sequenceId: "sequence-internal",
                contactId: "contact-internal",
                emailId: "email-internal",
                action: "open",
            }),
        );
    });

    it("records a transactional open without resolving campaign resources", async () => {
        mocks.verifyPixelToken.mockReturnValue({ type: "txe", txeId: "txe_1" });

        await get("/track/open?d=valid");
        await vi.waitFor(() =>
            expect(mocks.incrementOpen).toHaveBeenCalledWith("txe_1"),
        );

        expect(mocks.getContactByContactId).not.toHaveBeenCalled();
        expect(mocks.insertValues).not.toHaveBeenCalled();
    });

    it("fails soft when campaign resources were deleted", async () => {
        mocks.verifyPixelToken.mockReturnValue(campaignPayload());
        mocks.getContactByContactId.mockResolvedValue(null);

        const response = await get("/track/open?d=valid");
        await vi.waitFor(() =>
            expect(mocks.getContactByContactId).toHaveBeenCalled(),
        );

        expect(response.status).toBe(200);
        expect(mocks.insertValues).not.toHaveBeenCalled();
    });

    it("still returns the GIF when persistence fails", async () => {
        mocks.verifyPixelToken.mockReturnValue(campaignPayload());
        mocks.insertValues.mockRejectedValue(new Error("database unavailable"));

        const response = await get("/track/open?d=valid");
        await vi.waitFor(() => expect(mocks.captureError).toHaveBeenCalled());

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("image/gif");
    });

    it("records a transactional click and redirects to the decoded URL", async () => {
        mocks.verifyPixelToken.mockReturnValue({
            type: "txe",
            txeId: "txe_1",
            index: 2,
            link: encodeURIComponent("https://example.com/offer?a=1"),
        });

        const response = await get("/track/click?d=valid");

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("https://example.com/offer?a=1");
        expect(mocks.incrementClick).toHaveBeenCalledWith("txe_1");
    });

    it.each([null, { link: 42 }, { link: "%E0%A4%A" }])(
        "rejects an invalid click payload",
        async (payload) => {
            mocks.verifyPixelToken.mockReturnValue(payload);

            const response = await get("/track/click?d=invalid");

            expect(response.status).toBe(400);
            expect(mocks.incrementClick).not.toHaveBeenCalled();
            expect(mocks.insertValues).not.toHaveBeenCalled();
        },
    );

    it("unsubscribes idempotently and rejects an unknown token", async () => {
        mocks.getContactByUnsubscribeToken.mockResolvedValue({
            teamId: "team-internal",
            contactId: "cnt_public",
        });

        const first = await get("/unsubscribe/unsub-token");
        const second = await get("/unsubscribe/unsub-token");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(mocks.updateContact).toHaveBeenCalledTimes(2);
        expect(mocks.updateContact).toHaveBeenCalledWith(
            "team-internal",
            "cnt_public",
            { subscribed: false },
        );

        mocks.getContactByUnsubscribeToken.mockResolvedValue(null);
        const unknown = await get("/unsubscribe/unknown");
        expect(unknown.status).toBe(404);
    });
});
