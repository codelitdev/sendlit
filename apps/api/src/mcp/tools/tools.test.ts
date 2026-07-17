import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    countContacts: vi.fn(),
    createContact: vi.fn(),
    getContactByContactId: vi.fn(),
    getDeliveriesByContact: vi.fn(),
    listContacts: vi.fn(),
    updateContact: vi.fn(),
    addTagToContact: vi.fn(),
    removeTagFromContact: vi.fn(),
    deleteContact: vi.fn(),

    createSequence: vi.fn(),
    getSequenceBySequenceId: vi.fn(),
    getEmailSentCount: vi.fn(),
    getSequenceOpenRate: vi.fn(),
    getSequenceClickThroughRate: vi.fn(),
    getSubscribersCount: vi.fn(),
    getSubscribers: vi.fn(),
    listSequences: vi.fn(),
    countSequences: vi.fn(),
    updateSequence: vi.fn(),
    addMailToSequence: vi.fn(),
    updateMailInSequence: vi.fn(),
    deleteMailFromSequence: vi.fn(),
    startSequence: vi.fn(),
    pauseSequence: vi.fn(),

    getEspConfig: vi.fn(),
    upsertEspConfig: vi.fn(),
    deleteEspConfig: vi.fn(),
    recordEspTestResult: vi.fn(),
    listEspConfigs: vi.fn(),
    createEspConfig: vi.fn(),
    getEspConfigByEspId: vi.fn(),
    updateEspConfig: vi.fn(),
    invalidateTeamTransport: vi.fn(),
    invalidateEspTransport: vi.fn(),
    sendTestMail: vi.fn(),

    getTeam: vi.fn(),
    getTeamByTeamId: vi.fn(),
    getTeamMembership: vi.fn(),
    listTeamsForAccount: vi.fn(),
    createTeam: vi.fn(),
    deleteTeam: vi.fn(),
    renameTeam: vi.fn(),
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    getApiKeysByTeamId: vi.fn(),

    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    getTemplate: vi.fn(),
    listTemplates: vi.fn(),
    updateTemplate: vi.fn(),

    countMedia: vi.fn(),
    deleteUnusedMedia: vi.fn(),
    getMediaByMediaId: vi.fn(),
    listMedia: vi.fn(),
    listMediaReferences: vi.fn(),
    updateMediaMetadata: vi.fn(),

    createTransactionalEmail: vi.fn(),
    getTransactionalEmailByTxeId: vi.fn(),
    listTransactionalEmails: vi.fn(),
    countTransactionalEmails: vi.fn(),
    toPublicTransactionalEmail: vi.fn(),
}));

vi.mock("../../contacts/queries", () => ({
    countContacts: mocks.countContacts,
    createContact: mocks.createContact,
    getContactByContactId: mocks.getContactByContactId,
    getDeliveriesByContact: mocks.getDeliveriesByContact,
    listContacts: mocks.listContacts,
    updateContact: mocks.updateContact,
    addTagToContact: mocks.addTagToContact,
    removeTagFromContact: mocks.removeTagFromContact,
    deleteContact: mocks.deleteContact,
}));

vi.mock("../../contacts/segments-queries", () => ({
    createSegment: vi.fn(),
    deleteSegment: vi.fn(),
    getSegment: vi.fn(),
    listSegments: vi.fn(),
    updateSegment: vi.fn(),
}));

vi.mock("../../sequences/queries", () => ({
    createSequence: mocks.createSequence,
    getSequenceBySequenceId: mocks.getSequenceBySequenceId,
    getEmailSentCount: mocks.getEmailSentCount,
    getSequenceOpenRate: mocks.getSequenceOpenRate,
    getSequenceClickThroughRate: mocks.getSequenceClickThroughRate,
    getSubscribersCount: mocks.getSubscribersCount,
    getSubscribers: mocks.getSubscribers,
    listSequences: mocks.listSequences,
    countSequences: mocks.countSequences,
    updateSequence: mocks.updateSequence,
    addMailToSequence: mocks.addMailToSequence,
    updateMailInSequence: mocks.updateMailInSequence,
    deleteMailFromSequence: mocks.deleteMailFromSequence,
    startSequence: mocks.startSequence,
    pauseSequence: mocks.pauseSequence,
}));

vi.mock("../../settings/esp/queries", () => ({
    getEspConfig: mocks.getEspConfig,
    upsertEspConfig: mocks.upsertEspConfig,
    deleteEspConfig: mocks.deleteEspConfig,
    recordEspTestResult: mocks.recordEspTestResult,
    listEspConfigs: mocks.listEspConfigs,
    createEspConfig: mocks.createEspConfig,
    getEspConfigByEspId: mocks.getEspConfigByEspId,
    updateEspConfig: mocks.updateEspConfig,
}));

vi.mock("../../mail/transport", () => ({
    invalidateTeamTransport: mocks.invalidateTeamTransport,
    invalidateEspTransport: mocks.invalidateEspTransport,
}));

vi.mock("../../mail/send", () => ({
    sendTestMail: mocks.sendTestMail,
}));

vi.mock("../../team/queries", () => ({
    getTeam: mocks.getTeam,
    getTeamByTeamId: mocks.getTeamByTeamId,
    getTeamMembership: mocks.getTeamMembership,
    listTeamsForAccount: mocks.listTeamsForAccount,
    createTeam: mocks.createTeam,
    deleteTeam: mocks.deleteTeam,
    renameTeam: mocks.renameTeam,
}));

vi.mock("../../apikey/queries", () => ({
    createApiKey: mocks.createApiKey,
    deleteApiKey: mocks.deleteApiKey,
    getApiKeysByTeamId: mocks.getApiKeysByTeamId,
}));

vi.mock("../../templates/queries", () => ({
    createTemplate: mocks.createTemplate,
    deleteTemplate: mocks.deleteTemplate,
    getTemplate: mocks.getTemplate,
    listTemplates: mocks.listTemplates,
    updateTemplate: mocks.updateTemplate,
}));

vi.mock("../../media/queries", () => ({
    countMedia: mocks.countMedia,
    deleteUnusedMedia: mocks.deleteUnusedMedia,
    getMediaByMediaId: mocks.getMediaByMediaId,
    listMedia: mocks.listMedia,
    listMediaReferences: mocks.listMediaReferences,
    updateMediaMetadata: mocks.updateMediaMetadata,
}));

vi.mock("../../transactional/queries", () => ({
    createTransactionalEmail: mocks.createTransactionalEmail,
    getTransactionalEmailByTxeId: mocks.getTransactionalEmailByTxeId,
    listTransactionalEmails: mocks.listTransactionalEmails,
    countTransactionalEmails: mocks.countTransactionalEmails,
    toPublicTransactionalEmail: mocks.toPublicTransactionalEmail,
}));

import { AUTH_ERROR, NOT_FOUND, jsonResult } from "./responses";
import { getAuthAccount, getTeamId } from "./auth";
import { registerContactTools } from "./contacts";
import { registerEspTools } from "./esp";
import { registerSequenceTools } from "./sequences";
import { registerTeamTools } from "./teams";
import { registerTemplateTools } from "./templates";
import { registerMediaTools } from "./media";
import { registerTransactionalTools } from "./transactional";

type Tool = {
    config: any;
    handler: (args: any, extra?: any) => Promise<any>;
};

function makeToolRegistry(register: (server: any) => void) {
    const tools = new Map<string, Tool>();
    register({
        registerTool: (name: string, config: any, handler: Tool["handler"]) => {
            tools.set(name, { config, handler });
        },
    });
    return tools;
}

const auth = {
    authInfo: {
        clientId: "team-1",
        account: { id: "account-1", email: "owner@example.com", name: "Owner" },
    },
};

beforeEach(() => {
    for (const mock of Object.values(mocks)) {
        mock.mockReset();
    }
});

describe("MCP tool auth helpers and response helpers", () => {
    it("extracts team/account auth context and emits structured JSON results", () => {
        expect(getTeamId(auth)).toBe("team-1");
        expect(getTeamId({ authInfo: {} })).toBeNull();
        expect(getAuthAccount(auth)).toEqual(
            expect.objectContaining({ id: "account-1" }),
        );
        expect(getAuthAccount({ authInfo: {} })).toBeNull();

        expect(jsonResult({ ok: true })).toEqual({
            content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
            structuredContent: { ok: true },
        });
    });
});

describe("MCP contact tools", () => {
    it("requires auth and scopes list/create calls to the resolved team", async () => {
        const tools = makeToolRegistry(registerContactTools);
        const firstContactId = crypto.randomUUID();
        const secondContactId = crypto.randomUUID();
        mocks.listContacts.mockResolvedValue([{ contactId: firstContactId }]);
        mocks.countContacts.mockResolvedValue(1);

        await expect(
            tools.get("list_contacts")!.handler({ q: "ada", offset: 2 }, {}),
        ).resolves.toEqual(AUTH_ERROR);
        expect(mocks.listContacts).not.toHaveBeenCalled();

        await expect(
            tools.get("list_contacts")!.handler({ q: "ada", offset: 2 }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                items: [{ contactId: firstContactId }],
                total: 1,
            },
        });
        expect(mocks.listContacts).toHaveBeenCalledWith({
            teamId: "team-1",
            searchText: "ada",
            offset: 2,
        });

        mocks.createContact.mockResolvedValue({ contactId: secondContactId });
        await tools
            .get("create_contact")!
            .handler(
                { email: "reader@example.com", customFields: { plan: "pro" } },
                auth,
            );
        expect(mocks.createContact).toHaveBeenCalledWith({
            teamId: "team-1",
            email: "reader@example.com",
            customFields: { plan: "pro" },
        });
    });

    it("does not leak contacts from another team", async () => {
        const tools = makeToolRegistry(registerContactTools);
        const contactId = crypto.randomUUID();
        mocks.getContactByContactId.mockResolvedValue({
            contactId,
            teamId: "team-2",
        });

        await expect(
            tools.get("get_contact")!.handler({ contactId }, auth),
        ).resolves.toEqual(NOT_FOUND);
    });

    it("returns contact deliveries after checking contact ownership", async () => {
        const tools = makeToolRegistry(registerContactTools);
        const contactId = crypto.randomUUID();
        const internalContactId = crypto.randomUUID();
        mocks.getContactByContactId.mockResolvedValue({
            id: internalContactId,
            contactId,
            teamId: "team-1",
        });
        mocks.getDeliveriesByContact.mockResolvedValue([
            {
                sequenceId: "seq-1",
                sequenceTitle: "Welcome",
                sequenceType: "sequence",
                emailId: "email-1",
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
            },
        ]);

        await expect(
            tools.get("get_contact_deliveries")!.handler({ contactId }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                items: [
                    {
                        sequenceId: "seq-1",
                        sequenceTitle: "Welcome",
                        emailId: "email-1",
                    },
                ],
            },
        });
        expect(mocks.getDeliveriesByContact).toHaveBeenCalledWith(
            "team-1",
            internalContactId,
        );
    });
});

describe("MCP sequence tools", () => {
    it("validates non-empty template IDs on sequence creation/add-email inputs", () => {
        const tools = makeToolRegistry(registerSequenceTools);

        expect(
            tools
                .get("create_sequence")!
                .config.inputSchema.templateId.safeParse("").success,
        ).toBe(false);
        expect(
            tools
                .get("add_sequence_email")!
                .config.inputSchema.templateId.safeParse("").success,
        ).toBe(false);
    });

    it("checks sequence ownership before returning stats", async () => {
        const tools = makeToolRegistry(registerSequenceTools);
        mocks.getSequenceBySequenceId.mockResolvedValueOnce(null);

        await expect(
            tools
                .get("get_sequence_stats")!
                .handler({ sequenceId: "seq-1" }, auth),
        ).resolves.toEqual(NOT_FOUND);
        expect(mocks.getSequenceBySequenceId).toHaveBeenCalledWith(
            "team-1",
            "seq-1",
        );
        expect(mocks.getEmailSentCount).not.toHaveBeenCalled();

        mocks.getSequenceBySequenceId.mockResolvedValueOnce({
            sequenceId: "seq-1",
        });
        mocks.getEmailSentCount.mockResolvedValue(5);
        mocks.getSequenceOpenRate.mockResolvedValue(0.4);
        mocks.getSequenceClickThroughRate.mockResolvedValue(0.2);
        mocks.getSubscribersCount.mockResolvedValue(3);

        await expect(
            tools
                .get("get_sequence_stats")!
                .handler({ sequenceId: "seq-1" }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                sent: 5,
                openRate: 0.4,
                clickThroughRate: 0.2,
                subscribersCount: 3,
            },
        });
    });
});

describe("MCP ESP tools", () => {
    it("returns public ESP shape and invalidates transport on update", async () => {
        const tools = makeToolRegistry(registerEspTools);
        const config = {
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "user",
            encryptedSecret: "secret",
            fromName: "Sender",
            fromEmail: "sender@example.com",
            lastTestedAt: null,
            lastTestStatus: null,
            lastTestError: null,
        };
        mocks.upsertEspConfig.mockResolvedValue(config);

        const result = await tools.get("update_esp_config")!.handler(
            {
                provider: "smtp",
                host: "smtp.example.com",
                port: 587,
                secure: false,
            },
            auth,
        );

        expect(mocks.upsertEspConfig).toHaveBeenCalledWith("team-1", {
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
        });
        expect(mocks.invalidateTeamTransport).toHaveBeenCalledWith("team-1");
        expect(result.structuredContent).toMatchObject({
            provider: "smtp",
            hasPassword: true,
        });
        expect(result.structuredContent).not.toHaveProperty("encryptedSecret");
    });

    it("requires an explicit destination for API-key test sends", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.getEspConfig.mockResolvedValue({
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
        });

        await expect(
            tools
                .get("send_test_email")!
                .handler({}, { authInfo: { clientId: "team-1" } }),
        ).resolves.toMatchObject({
            structuredContent: {
                success: false,
                error: "No destination email address available.",
            },
        });
        expect(mocks.sendTestMail).not.toHaveBeenCalled();
    });

    it("lists user-managed ESP configurations", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.listEspConfigs.mockResolvedValue([
            { espId: "esp_1", name: "Primary", isDefault: true },
            { espId: "esp_2", name: "Backup", isDefault: false },
        ]);

        const result = await tools.get("list_esps")!.handler(auth);

        expect(mocks.listEspConfigs).toHaveBeenCalledWith("team-1");
        expect(result.structuredContent).toMatchObject({
            items: [
                { espId: "esp_1", isDefault: true },
                { espId: "esp_2", isDefault: false },
            ],
        });
    });

    it("creates a named user-managed ESP configuration", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.createEspConfig.mockResolvedValue({
            espId: "esp_2",
            name: "Backup",
            isDefault: false,
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
        });

        const result = await tools.get("create_esp")!.handler(
            {
                name: "Backup",
                provider: "smtp",
                host: "smtp.example.com",
                port: 587,
                secure: false,
            },
            auth,
        );

        expect(mocks.createEspConfig).toHaveBeenCalledWith("team-1", {
            name: "Backup",
            provider: "smtp",
            host: "smtp.example.com",
            port: 587,
            secure: false,
        });
        expect(mocks.invalidateTeamTransport).toHaveBeenCalledWith("team-1");
        expect(result.structuredContent).toMatchObject({ espId: "esp_2" });
    });

    it("returns NOT_FOUND when getting an unknown espId", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.getEspConfigByEspId.mockResolvedValue(null);

        const result = await tools
            .get("get_esp")!
            .handler({ espId: "esp_missing" }, auth);

        expect(result).toBe(NOT_FOUND);
    });

    it("updates a user-managed ESP and invalidates its transport", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.updateEspConfig.mockResolvedValue({
            id: "internal-2",
            espId: "esp_2",
            name: "Backup",
            isDefault: true,
        });

        const result = await tools
            .get("update_esp")!
            .handler({ espId: "esp_2", isDefault: true }, auth);

        expect(mocks.updateEspConfig).toHaveBeenCalledWith("team-1", "esp_2", {
            isDefault: true,
        });
        expect(mocks.invalidateEspTransport).toHaveBeenCalledWith(
            "team-1",
            "internal-2",
        );
        expect(mocks.invalidateTeamTransport).toHaveBeenCalledWith("team-1");
        expect(result.structuredContent).toMatchObject({ espId: "esp_2" });
    });

    it("surfaces esp_in_use as a friendly error when deleting", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.getEspConfigByEspId.mockResolvedValue({
            id: "internal-2",
            espId: "esp_2",
            isDefault: false,
        });
        mocks.deleteEspConfig.mockRejectedValue(new Error("esp_in_use"));

        const result = await tools
            .get("delete_esp")!
            .handler({ espId: "esp_2" }, auth);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("in use");
    });

    it("tests a specific ESP by espId", async () => {
        const tools = makeToolRegistry(registerEspTools);
        mocks.getEspConfigByEspId.mockResolvedValue({
            id: "internal-2",
            teamId: "team-1",
            espId: "esp_2",
            provider: "smtp",
            fromName: null,
            fromEmail: null,
        });
        mocks.sendTestMail.mockResolvedValue(undefined);

        const result = await tools
            .get("test_esp")!
            .handler({ espId: "esp_2", to: "dest@example.com" }, auth);

        expect(mocks.getEspConfigByEspId).toHaveBeenCalledWith(
            "team-1",
            "esp_2",
        );
        expect(mocks.sendTestMail).toHaveBeenCalled();
        expect(result.structuredContent).toMatchObject({ success: true });
    });
});

describe("MCP team and template tools", () => {
    it("requires OAuth account context to list teams", async () => {
        const tools = makeToolRegistry(registerTeamTools);

        await expect(
            tools
                .get("list_teams")!
                .handler({ authInfo: { clientId: "team-1" } }),
        ).resolves.toEqual(AUTH_ERROR);

        mocks.listTeamsForAccount.mockResolvedValue([
            { id: "team-1", teamId: "team-1", name: "Main", ignored: true },
        ]);
        await expect(
            tools.get("list_teams")!.handler(auth),
        ).resolves.toMatchObject({
            structuredContent: { items: [{ teamId: "team-1", name: "Main" }] },
        });
        expect(mocks.listTeamsForAccount).toHaveBeenCalledWith("account-1");
    });

    it("creates teams for the authenticated account", async () => {
        const tools = makeToolRegistry(registerTeamTools);
        mocks.createTeam.mockResolvedValue({
            id: "internal-team-2",
            teamId: "team-2",
            name: "Second Team",
        });

        await expect(
            tools.get("create_team")!.handler({ name: "Second Team" }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                teamId: "team-2",
                name: "Second Team",
            },
        });
        expect(mocks.createTeam).toHaveBeenCalledWith({
            ownerAccountId: "account-1",
            name: "Second Team",
        });
    });

    it("only lets team owners delete teams", async () => {
        const tools = makeToolRegistry(registerTeamTools);
        mocks.getTeamByTeamId.mockResolvedValue({
            id: "internal-team-2",
            teamId: "team-2",
            name: "Second Team",
        });
        mocks.getTeamMembership.mockResolvedValueOnce({ role: "member" });

        await expect(
            tools.get("delete_team")!.handler({ teamId: "team-2" }, auth),
        ).resolves.toMatchObject({
            isError: true,
        });
        expect(mocks.deleteTeam).not.toHaveBeenCalled();

        mocks.getTeamMembership.mockResolvedValueOnce({ role: "owner" });
        await expect(
            tools.get("delete_team")!.handler({ teamId: "team-2" }, auth),
        ).resolves.toMatchObject({
            structuredContent: { message: "Team deleted." },
        });
        expect(mocks.deleteTeam).toHaveBeenCalledWith("internal-team-2");
    });

    it("keeps template ID inputs non-empty across template tools", () => {
        const tools = makeToolRegistry(registerTemplateTools);

        for (const toolName of [
            "get_template",
            "update_template",
            "delete_template",
        ]) {
            expect(
                tools.get(toolName)!.config.inputSchema.templateId.safeParse("")
                    .success,
            ).toBe(false);
        }
    });
});

describe("MCP media tools", () => {
    it("lists and updates media within the resolved team", async () => {
        const tools = makeToolRegistry(registerMediaTools);
        mocks.listMedia.mockResolvedValue([
            {
                id: "internal-media-1",
                teamId: "team-1",
                mediaId: "med_1",
                url: "https://cdn.test/p/media-lit/main.webp",
                mediaLitId: "media-lit",
            },
        ]);
        mocks.countMedia.mockResolvedValue(1);

        await expect(
            tools.get("list_media")!.handler({ query: "hero", page: 2 }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                items: [
                    {
                        mediaId: "med_1",
                        url: "https://cdn.test/p/media-lit/main.webp",
                    },
                ],
                total: 1,
            },
        });
        expect(mocks.listMedia).toHaveBeenCalledWith({
            teamId: "team-1",
            query: "hero",
            page: 2,
            pageSize: undefined,
        });
        expect(mocks.countMedia).toHaveBeenCalledWith({
            teamId: "team-1",
            query: "hero",
        });

        mocks.updateMediaMetadata.mockResolvedValue({
            id: "internal-media-1",
            teamId: "team-1",
            mediaId: "med_1",
            url: "https://cdn.test/p/media-lit/main.webp",
            mediaLitId: "media-lit",
            alt: "Hero",
        });
        await tools
            .get("update_media")!
            .handler({ mediaId: "med_1", alt: "Hero" }, auth);
        expect(mocks.updateMediaMetadata).toHaveBeenCalledWith({
            teamId: "team-1",
            mediaId: "med_1",
            alt: "Hero",
            caption: undefined,
        });
    });

    it("blocks deleting in-use media and lists references", async () => {
        const tools = makeToolRegistry(registerMediaTools);
        mocks.deleteUnusedMedia.mockResolvedValue("in_use");

        await expect(
            tools.get("delete_media")!.handler({ mediaId: "med_1" }, auth),
        ).resolves.toMatchObject({
            isError: true,
        });
        expect(mocks.deleteUnusedMedia).toHaveBeenCalledWith("team-1", "med_1");

        mocks.listMediaReferences.mockResolvedValue([
            {
                resourceType: "SEQUENCE_EMAIL",
                resourcePublicId: "email_1",
                parentResourcePublicId: "seq_1",
            },
        ]);
        await expect(
            tools
                .get("list_media_references")!
                .handler({ mediaId: "med_1" }, auth),
        ).resolves.toMatchObject({
            structuredContent: {
                items: [
                    {
                        resourceType: "SEQUENCE_EMAIL",
                        resourcePublicId: "email_1",
                        parentResourcePublicId: "seq_1",
                    },
                ],
            },
        });
    });
});

describe("MCP transactional tools", () => {
    it("requires auth for send_email/get_email/list_emails", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);

        await expect(
            tools
                .get("send_email")!
                .handler(
                    { to: "a@example.com", subject: "Hi", html: "<p>hi</p>" },
                    {},
                ),
        ).resolves.toEqual(AUTH_ERROR);
        expect(mocks.createTransactionalEmail).not.toHaveBeenCalled();

        await expect(
            tools.get("get_email")!.handler({ txeId: "txe_1" }, {}),
        ).resolves.toEqual(AUTH_ERROR);
        expect(mocks.getTransactionalEmailByTxeId).not.toHaveBeenCalled();

        await expect(
            tools.get("list_emails")!.handler({}, {}),
        ).resolves.toEqual(AUTH_ERROR);
        expect(mocks.listTransactionalEmails).not.toHaveBeenCalled();
    });

    it("sends an email and forwards the resolved team/args", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        mocks.createTransactionalEmail.mockResolvedValue({
            txeId: "txe_1",
            status: "queued",
        });

        await expect(
            tools.get("send_email")!.handler(
                {
                    to: "reader@example.com",
                    subject: "Receipt",
                    html: "<p>Thanks!</p>",
                    idempotencyKey: "key-1",
                },
                auth,
            ),
        ).resolves.toMatchObject({
            structuredContent: { txeId: "txe_1", status: "queued" },
        });
        expect(mocks.createTransactionalEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                to: "reader@example.com",
                subject: "Receipt",
                html: "<p>Thanks!</p>",
                idempotencyKey: "key-1",
            }),
        );
    });

    it("maps each createTransactionalEmail error to the matching tool message", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        const cases: Array<[string, string]> = [
            [
                "invalid_content",
                "Provide exactly one of templateId or html; variables requires templateId",
            ],
            ["template_not_found", "Template not found"],
            ["esp_not_configured", "Team ESP is not configured."],
            ["esp_not_found", "ESP not found"],
        ];

        for (const [errorMessage, expectedText] of cases) {
            mocks.createTransactionalEmail.mockRejectedValueOnce(
                new Error(errorMessage),
            );
            await expect(
                tools.get("send_email")!.handler(
                    {
                        to: "a@example.com",
                        subject: "Hi",
                        html: "<p>hi</p>",
                    },
                    auth,
                ),
            ).resolves.toEqual({
                content: [{ type: "text", text: expectedText }],
                isError: true,
            });
        }
    });

    it("rethrows unmapped errors from send_email", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        mocks.createTransactionalEmail.mockRejectedValueOnce(new Error("boom"));

        await expect(
            tools
                .get("send_email")!
                .handler(
                    { to: "a@example.com", subject: "Hi", html: "<p>hi</p>" },
                    auth,
                ),
        ).rejects.toThrow("boom");
    });

    it("returns NOT_FOUND for get_email when the row belongs to another team", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        mocks.getTransactionalEmailByTxeId.mockResolvedValue({
            txeId: "txe_1",
            teamId: "team-2",
        });

        await expect(
            tools.get("get_email")!.handler({ txeId: "txe_1" }, auth),
        ).resolves.toEqual(NOT_FOUND);
        expect(mocks.toPublicTransactionalEmail).not.toHaveBeenCalled();
    });

    it("returns the public shape (with html) for an owned email", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        const row = { txeId: "txe_1", teamId: "team-1", html: "<p>hi</p>" };
        mocks.getTransactionalEmailByTxeId.mockResolvedValue(row);
        mocks.toPublicTransactionalEmail.mockReturnValue({
            txeId: "txe_1",
            html: "<p>hi</p>",
        });

        await expect(
            tools.get("get_email")!.handler({ txeId: "txe_1" }, auth),
        ).resolves.toMatchObject({
            structuredContent: { txeId: "txe_1", html: "<p>hi</p>" },
        });
        expect(mocks.toPublicTransactionalEmail).toHaveBeenCalledWith(row, {
            includeHtml: true,
        });
    });

    it("scopes list_emails to the resolved team and returns items/total", async () => {
        const tools = makeToolRegistry(registerTransactionalTools);
        const row = { txeId: "txe_1", teamId: "team-1" };
        mocks.listTransactionalEmails.mockResolvedValue([row]);
        mocks.countTransactionalEmails.mockResolvedValue(1);
        mocks.toPublicTransactionalEmail.mockReturnValue({ txeId: "txe_1" });

        await expect(
            tools
                .get("list_emails")!
                .handler({ status: "sent", offset: 2 }, auth),
        ).resolves.toMatchObject({
            structuredContent: { items: [{ txeId: "txe_1" }], total: 1 },
        });
        expect(mocks.listTransactionalEmails).toHaveBeenCalledWith({
            teamId: "team-1",
            status: "sent",
            createdAfter: undefined,
            createdBefore: undefined,
            offset: 2,
            rowsPerPage: undefined,
        });
        expect(mocks.countTransactionalEmails).toHaveBeenCalledWith("team-1", {
            status: "sent",
            createdAfter: undefined,
            createdBefore: undefined,
        });
        expect(mocks.toPublicTransactionalEmail).toHaveBeenCalledWith(row, {
            includeHtml: false,
        });
    });
});
