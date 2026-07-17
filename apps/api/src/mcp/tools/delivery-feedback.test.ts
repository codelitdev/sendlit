import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getEspConfigByEspId: vi.fn(),
    listEspConfigs: vi.fn(),
    getFeedbackConnectionForTeamEsp: vi.fn(),
    upsertFeedbackConnection: vi.fn(),
    decryptFeedbackCredentials: vi.fn(),
    recordFeedbackConnectionVerified: vi.fn(),
    disableFeedbackConnection: vi.fn(),
    listDeliveryEvents: vi.fn(),
    countDeliveryEvents: vi.fn(),
    getDeliveryEventByEventId: vi.fn(),
    getOutboundMessagesByIds: vi.fn(),
    listSuppressions: vi.fn(),
    countSuppressions: vi.fn(),
    getSuppressionBySuppressionId: vi.fn(),
    releaseSuppression: vi.fn(),
}));

vi.mock("../../settings/esp/queries", () => ({
    getEspConfigByEspId: mocks.getEspConfigByEspId,
    listEspConfigs: mocks.listEspConfigs,
}));
vi.mock("../../delivery-feedback/feedback-connection-queries", () => ({
    getFeedbackConnectionForTeamEsp: mocks.getFeedbackConnectionForTeamEsp,
    upsertFeedbackConnection: mocks.upsertFeedbackConnection,
    decryptFeedbackCredentials: mocks.decryptFeedbackCredentials,
    recordFeedbackConnectionVerified: mocks.recordFeedbackConnectionVerified,
    disableFeedbackConnection: mocks.disableFeedbackConnection,
}));
vi.mock("../../delivery-feedback/delivery-event-queries", () => ({
    listDeliveryEvents: mocks.listDeliveryEvents,
    countDeliveryEvents: mocks.countDeliveryEvents,
    getDeliveryEventByEventId: mocks.getDeliveryEventByEventId,
}));
vi.mock("../../delivery-feedback/outbound-queries", () => ({
    getOutboundMessagesByIds: mocks.getOutboundMessagesByIds,
}));
vi.mock("../../delivery-feedback/suppression-queries", () => ({
    listSuppressions: mocks.listSuppressions,
    countSuppressions: mocks.countSuppressions,
    getSuppressionBySuppressionId: mocks.getSuppressionBySuppressionId,
    releaseSuppression: mocks.releaseSuppression,
}));

import { AUTH_ERROR, NOT_FOUND } from "./responses";
import { registerDeliveryFeedbackTools } from "./delivery-feedback";

type Tool = { handler: (args: any, extra?: any) => Promise<any> };

function makeToolRegistry() {
    const tools = new Map<string, Tool>();
    registerDeliveryFeedbackTools({
        registerTool: (
            name: string,
            _config: any,
            handler: Tool["handler"],
        ) => {
            tools.set(name, { handler });
        },
    } as any);
    return tools;
}

const auth = { authInfo: { clientId: "team-1", account: { id: "account-1" } } };

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getOutboundMessagesByIds.mockResolvedValue(new Map());
    mocks.listEspConfigs.mockResolvedValue([]);
});

describe("MCP delivery-feedback tools", () => {
    it("requires auth on every tool", async () => {
        const tools = makeToolRegistry();
        await expect(
            tools
                .get("get_esp_feedback_connection")!
                .handler({ espId: "x" }, {}),
        ).resolves.toEqual(AUTH_ERROR);
        await expect(
            tools.get("list_suppressions")!.handler({}, {}),
        ).resolves.toEqual(AUTH_ERROR);
    });

    it("rejects configuring feedback for a provider without a reviewed adapter", async () => {
        const tools = makeToolRegistry();
        mocks.getEspConfigByEspId.mockResolvedValue({
            id: "esp-internal-1",
            espId: "esp_1",
            provider: "ses",
        });

        const result = await tools
            .get("upsert_esp_feedback_connection")!
            .handler({ espId: "esp_1", credential: "secret" }, auth);

        expect(result.isError).toBe(true);
        expect(mocks.upsertFeedbackConnection).not.toHaveBeenCalled();
    });

    it("upserts a feedback connection for a capable provider", async () => {
        const tools = makeToolRegistry();
        mocks.getEspConfigByEspId.mockResolvedValue({
            id: "esp-internal-1",
            espId: "esp_1",
            provider: "postmark",
        });
        mocks.upsertFeedbackConnection.mockResolvedValue({
            id: "conn-1",
            connectionId: "whc_abc",
            provider: "postmark",
            encryptedCredentials: "enc",
            status: "pending",
            lastReceivedAt: null,
            lastVerifiedAt: null,
            lastErrorCode: null,
        });

        const result = await tools
            .get("upsert_esp_feedback_connection")!
            .handler({ espId: "esp_1", credential: "top-secret" }, auth);

        expect(mocks.upsertFeedbackConnection).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                espConfigId: "esp-internal-1",
                provider: "postmark",
                credential: "top-secret",
            }),
        );
        expect(result.structuredContent).toMatchObject({
            connectionId: "whc_abc",
            espId: "esp_1",
            hasCredential: true,
        });
    });

    it("returns not-found for an unknown espId on get", async () => {
        const tools = makeToolRegistry();
        mocks.getEspConfigByEspId.mockResolvedValue(null);

        const result = await tools
            .get("get_esp_feedback_connection")!
            .handler({ espId: "esp_missing" }, auth);

        expect(result).toEqual(NOT_FOUND);
    });

    it("blocks a workspace user from releasing a complaint suppression", async () => {
        const tools = makeToolRegistry();
        mocks.releaseSuppression.mockRejectedValue(
            new Error("suppression_not_releasable"),
        );

        const result = await tools
            .get("release_suppression")!
            .handler({ suppressionId: "sup_1" }, auth);

        expect(mocks.releaseSuppression).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                suppressionId: "sup_1",
                actorType: "workspace_user",
                actorUserId: "account-1",
            }),
        );
        expect(result.isError).toBe(true);
    });

    it("releases an eligible suppression", async () => {
        const tools = makeToolRegistry();
        mocks.releaseSuppression.mockResolvedValue({
            suppressionId: "sup_1",
            recipientEmail: "ada@example.com",
            reason: "hard_bounce",
            active: false,
            firstSuppressedAt: new Date(),
            lastSuppressedAt: new Date(),
            releasedAt: new Date(),
            releaseReason: "mailbox fixed",
        });

        const result = await tools
            .get("release_suppression")!
            .handler(
                { suppressionId: "sup_1", explanation: "mailbox fixed" },
                auth,
            );

        expect(result.structuredContent).toMatchObject({
            suppressionId: "sup_1",
            active: false,
        });
    });

    it("lists suppressions scoped to the team", async () => {
        const tools = makeToolRegistry();
        mocks.listSuppressions.mockResolvedValue([
            {
                suppressionId: "sup_1",
                recipientEmail: "ada@example.com",
                reason: "hard_bounce",
                active: true,
                firstSuppressedAt: new Date(),
                lastSuppressedAt: new Date(),
                releasedAt: null,
                releaseReason: null,
            },
        ]);
        mocks.countSuppressions.mockResolvedValue(1);

        const result = await tools.get("list_suppressions")!.handler({}, auth);

        expect(mocks.listSuppressions).toHaveBeenCalledWith(
            expect.objectContaining({ teamId: "team-1" }),
        );
        expect(result.structuredContent).toMatchObject({ total: 1 });
    });
});
