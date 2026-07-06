import { describe, expect, it } from "vitest";
import { defaultEmail } from "@sendlit/email-editor";
import {
    createContactBodySchema,
    listContactsQuerySchema,
    parseContactFilterQueryParam,
    updateContactBodySchema,
} from "../../../packages/api-contract/src/schemas/contacts";
import {
    createTemplateBodySchema,
    updateTemplateBodySchema,
} from "../../../packages/api-contract/src/schemas/templates";
import {
    addSequenceEmailBodySchema,
    createSequenceBodySchema,
    listSequencesQuerySchema,
    updateSequenceBodySchema,
    updateSequenceEmailBodySchema,
} from "../../../packages/api-contract/src/schemas/sequences";
import {
    testEspConfigBodySchema,
    upsertEspConfigBodySchema,
} from "../../../packages/api-contract/src/schemas/esp";
import {
    createApiKeyBodySchema,
    createTeamBodySchema,
    provisionTeamBodySchema,
    renameTeamBodySchema,
} from "../../../packages/api-contract/src/schemas/teams";
import { openApiDocument } from "./openapi";

describe("API input validation schemas", () => {
    it("validates contact create/update bodies and paginated query strings", () => {
        expect(
            createContactBodySchema.safeParse({
                email: "not-an-email",
                tags: "vip",
            }).success,
        ).toBe(false);
        expect(
            createContactBodySchema.safeParse({
                email: "reader@example.com",
                name: "Reader",
                tags: ["vip"],
                customFields: {
                    plan: "pro",
                    score: 10,
                    roles: ["admin", "author"],
                },
            }).success,
        ).toBe(true);

        expect(
            updateContactBodySchema.safeParse({
                subscribed: "false",
            }).success,
        ).toBe(false);
        expect(
            listContactsQuerySchema.parse({
                offset: "2",
                rowsPerPage: "25",
                filter: JSON.stringify({
                    aggregator: "and",
                    filters: [
                        {
                            name: "email",
                            condition: "contains",
                            value: "@example.com",
                        },
                    ],
                }),
            }),
        ).toEqual({
            offset: 2,
            rowsPerPage: 25,
            filter: JSON.stringify({
                aggregator: "and",
                filters: [
                    {
                        name: "email",
                        condition: "contains",
                        value: "@example.com",
                    },
                ],
            }),
        });
        expect(
            parseContactFilterQueryParam(
                JSON.stringify({
                    aggregator: "and",
                    filters: [
                        {
                            name: "email",
                            condition: "contains",
                            value: "@example.com",
                        },
                    ],
                }),
            ),
        ).toMatchObject({
            success: true,
            data: {
                aggregator: "and",
                filters: [
                    {
                        name: "email",
                        condition: "contains",
                        value: "@example.com",
                    },
                ],
            },
        });
        expect(
            parseContactFilterQueryParam(
                JSON.stringify({
                    aggregator: "and",
                    filters: [
                        {
                            name: "product",
                            condition: "has",
                            value: "course-1",
                        },
                    ],
                }),
            ).success,
        ).toBe(false);
        expect(
            parseContactFilterQueryParam(
                JSON.stringify({
                    aggregator: "and",
                    filters: [
                        {
                            name: "customField",
                            key: "courselit.products",
                            condition: "has",
                            value: "course_123",
                        },
                    ],
                }),
            ).success,
        ).toBe(true);
        expect(
            parseContactFilterQueryParam(
                JSON.stringify({
                    aggregator: "and",
                    filters: [
                        {
                            name: "tag",
                            condition: "contains",
                            value: "vip",
                        },
                    ],
                }),
            ).success,
        ).toBe(false);
        expect(listContactsQuerySchema.safeParse({ offset: "0" }).success).toBe(
            false,
        );
        expect(parseContactFilterQueryParam("not-json").success).toBe(false);
    });

    it("validates template titles and email-editor content shape", () => {
        expect(
            createTemplateBodySchema.safeParse({
                title: "",
                content: defaultEmail,
            }).success,
        ).toBe(false);
        expect(
            createTemplateBodySchema.safeParse({
                title: "Welcome",
                content: { content: [] },
            }).success,
        ).toBe(false);
        expect(
            updateTemplateBodySchema.safeParse({
                title: "Welcome",
                content: defaultEmail,
            }).success,
        ).toBe(true);
    });

    it("validates sequence type, filters, email actions, and pagination", () => {
        expect(
            createSequenceBodySchema.safeParse({
                type: "drip",
                templateId: "template-1",
            }).success,
        ).toBe(false);
        expect(
            createSequenceBodySchema.safeParse({
                type: "sequence",
                templateId: "",
            }).success,
        ).toBe(false);
        expect(
            createSequenceBodySchema.safeParse({
                type: "sequence",
                templateId: "template-1",
            }).success,
        ).toBe(true);

        expect(
            updateSequenceBodySchema.safeParse({
                fromEmail: "not-an-email",
                filter: { aggregator: "xor", filters: [] },
            }).success,
        ).toBe(false);
        expect(
            updateSequenceBodySchema.safeParse({
                fromEmail: "sender@example.com",
                filter: {
                    aggregator: "and",
                    filters: [
                        {
                            name: "tag",
                            condition: "is",
                            value: "vip",
                        },
                    ],
                },
            }).success,
        ).toBe(true);
        expect(
            updateSequenceBodySchema.safeParse({
                filter: {
                    aggregator: "and",
                    filters: [
                        {
                            name: "tag",
                            condition: "contains",
                            value: "vip",
                        },
                    ],
                },
            }).success,
        ).toBe(false);

        expect(
            addSequenceEmailBodySchema.safeParse({ templateId: "" }).success,
        ).toBe(false);
        expect(
            updateSequenceEmailBodySchema.safeParse({
                actionType: "tag:rename",
            }).success,
        ).toBe(false);
        expect(
            updateSequenceEmailBodySchema.safeParse({
                actionType: "tag:add",
                actionData: { tag: "vip" },
                content: defaultEmail,
                published: true,
            }).success,
        ).toBe(true);

        expect(listSequencesQuerySchema.parse({ type: "broadcast" })).toEqual({
            type: "broadcast",
        });
        expect(
            listSequencesQuerySchema.safeParse({ type: "newsletter" }).success,
        ).toBe(false);
    });

    it("validates ESP config and test-send bodies", () => {
        expect(
            upsertEspConfigBodySchema.safeParse({
                provider: "smtp",
                host: "smtp.example.com",
                port: "587",
                secure: false,
            }).success,
        ).toBe(false);
        expect(
            upsertEspConfigBodySchema.safeParse({
                provider: "smtp",
                host: "smtp.example.com",
                port: 587,
                secure: false,
                fromEmail: "sender@example.com",
            }).success,
        ).toBe(true);
        expect(
            upsertEspConfigBodySchema.safeParse({
                provider: "smtp",
                host: "",
                port: 70_000,
                secure: false,
                fromEmail: "bad",
            }).success,
        ).toBe(false);

        expect(testEspConfigBodySchema.safeParse({ to: "bad" }).success).toBe(
            false,
        );
        expect(
            testEspConfigBodySchema.safeParse({
                to: "recipient@example.com",
            }).success,
        ).toBe(true);
    });

    it("validates team management and provisioning bodies", () => {
        for (const schema of [
            createTeamBodySchema,
            renameTeamBodySchema,
            createApiKeyBodySchema,
        ]) {
            expect(schema.safeParse({ name: "" }).success).toBe(false);
            expect(schema.safeParse({ name: "Main" }).success).toBe(true);
        }

        expect(
            provisionTeamBodySchema.safeParse({
                externalId: "",
                ownerEmail: "bad",
                name: "",
            }).success,
        ).toBe(false);
        expect(
            provisionTeamBodySchema.safeParse({
                externalId: "consumer:tenant-1",
                ownerEmail: "owner@example.com",
                name: "Tenant 1",
            }).success,
        ).toBe(true);
    });
});

describe("OpenAPI authentication metadata", () => {
    it("declares API key auth globally so Swagger UI sends the header", () => {
        expect(openApiDocument.components?.securitySchemes).toMatchObject({
            apiKeyAuth: {
                type: "apiKey",
                in: "header",
                name: "x-sendlit-apikey",
            },
            provisioningSecretAuth: {
                type: "apiKey",
                in: "header",
                name: "X-Sendlit-Provisioning-Secret",
            },
        });
        expect(openApiDocument.security).toContainEqual({ apiKeyAuth: [] });
        expect(
            openApiDocument.paths["/provisioning/teams"]?.post,
        ).toMatchObject({
            security: [{ provisioningSecretAuth: [] }],
        });
    });
});
