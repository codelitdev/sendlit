import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok, Query } from "../http";
import { assertId } from "../validate";

const routes = contract.templates;

export type EmailTemplate = Ok<typeof routes.get>;
export type SystemTemplate = Ok<typeof routes.listSystem>["items"][number];
export type CreateTemplateInput = Body<typeof routes.create>;
export type UpdateTemplateInput = Body<typeof routes.update>;
export type DuplicateTemplateInput = Body<typeof routes.duplicate>;
export type ListTemplatesQuery = Query<typeof routes.list>;

export class Templates {
    constructor(private readonly http: HttpClient) {}

    async list(query: ListTemplatesQuery = {}): Promise<EmailTemplate[]> {
        return this.http.request(routes.list, { query });
    }

    /** Built-in starters, shared by every team. Duplicate one into the team
     * before using it for transactional sends. */
    async listSystem(
        query: ListTemplatesQuery = {},
    ): Promise<Ok<typeof routes.listSystem>> {
        return this.http.request(routes.listSystem, { query });
    }

    async get(templateId: string): Promise<EmailTemplate> {
        return this.http.request(routes.get, {
            params: { templateId: assertId(templateId, "templateId") },
        });
    }

    async create(input: CreateTemplateInput): Promise<EmailTemplate> {
        return this.http.request(routes.create, { body: input });
    }

    async update(
        templateId: string,
        input: UpdateTemplateInput,
    ): Promise<EmailTemplate> {
        return this.http.request(routes.update, {
            params: { templateId: assertId(templateId, "templateId") },
            body: input,
        });
    }

    async duplicate(
        templateId: string,
        input: DuplicateTemplateInput = {},
    ): Promise<EmailTemplate> {
        return this.http.request(routes.duplicate, {
            params: { templateId: assertId(templateId, "templateId") },
            body: input,
        });
    }

    async remove(templateId: string): Promise<void> {
        await this.http.request(routes.remove, {
            params: { templateId: assertId(templateId, "templateId") },
        });
    }
}
