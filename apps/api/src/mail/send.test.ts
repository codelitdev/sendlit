import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
const getTeamTransportMock = vi.fn();
const captureErrorMock = vi.fn();
const captureEventMock = vi.fn();

vi.mock("./transport", () => ({
    getTeamTransport: getTeamTransportMock,
}));

vi.mock("../observability/posthog", () => ({
    captureError: captureErrorMock,
    captureEvent: captureEventMock,
}));

vi.mock("../services/log", () => ({
    default: {
        info: vi.fn(),
    },
}));

describe("sendMail", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env.NODE_ENV = "production";
    });

    it("fails clearly when a team has no ESP configured", async () => {
        getTeamTransportMock.mockResolvedValue(null);
        const { sendMail } = await import("./send.js");

        await expect(
            sendMail({
                from: "Sender <sender@example.com>",
                to: "contact@example.com",
                subject: "Hello",
                html: "<p>Hello</p>",
                teamId: "team-1",
            }),
        ).rejects.toThrow("Team ESP is not configured.");

        expect(sendMailMock).not.toHaveBeenCalled();
        expect(captureErrorMock).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "mail.send",
                teamId: "team-1",
                severity: "critical",
            }),
        );
    });

    it("sends through the team's configured ESP", async () => {
        getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
        const { sendMail } = await import("./send.js");

        await sendMail({
            from: "Sender <sender@example.com>",
            to: "contact@example.com",
            subject: "Hello",
            html: "<p>Hello</p>",
            headers: { "List-Unsubscribe": "<mailto:unsubscribe@example.com>" },
            teamId: "team-1",
        });

        expect(sendMailMock).toHaveBeenCalledWith({
            from: "Sender <sender@example.com>",
            to: "contact@example.com",
            subject: "Hello",
            html: "<p>Hello</p>",
            headers: { "List-Unsubscribe": "<mailto:unsubscribe@example.com>" },
        });
        expect(captureEventMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "email_sent",
                source: "mail.send",
                teamId: "team-1",
            }),
        );
    });
});
