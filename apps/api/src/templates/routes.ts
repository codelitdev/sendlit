import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    createTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplate,
    listTemplates,
    updateTemplate,
} from "./queries";
import { SYSTEM_TEMPLATES } from "./system-templates";
import { serializeDates } from "../utils/serialize";
import { omitInternal } from "../utils/public";
import { TemplateValidationError } from "./validation";

const router = Router();
router.use(["/system-templates", "/templates"], requireAuth);

const s = initServer();

// Not team-scoped \u2014 mounted before `requireTeam` runs.
const systemContract = { listSystem: contract.templates.listSystem };
const systemImpl = s.router(systemContract, {
    listSystem: async ({ query }) => ({
        status: 200,
        body: {
            items: query.purpose
                ? SYSTEM_TEMPLATES.filter(
                      (template) => template.purpose === query.purpose,
                  )
                : SYSTEM_TEMPLATES,
        },
    }),
});
createExpressEndpoints(systemContract, systemImpl, router);

router.use("/templates", requireTeam);

const restContract = {
    create: contract.templates.create,
    list: contract.templates.list,
    get: contract.templates.get,
    update: contract.templates.update,
    duplicate: contract.templates.duplicate,
    remove: contract.templates.remove,
};

const restImpl = s.router(restContract, {
    create: async ({ body, req }) => {
        try {
            const template = await createTemplate({
                teamId: (req as any).teamId,
                title: body.title,
                purpose: body.purpose,
                content: body.content as any,
            });
            return {
                status: 201,
                body: serializeDates(omitInternal(template)) as any,
            };
        } catch (error) {
            if (error instanceof TemplateValidationError) {
                return {
                    status: 422,
                    body: {
                        error: error.message,
                        variables: error.variables,
                    },
                };
            }
            throw error;
        }
    },
    list: async ({ query, req }) => {
        const templates = await listTemplates(
            (req as any).teamId,
            query.purpose,
        );
        return {
            status: 200,
            body: serializeDates(templates.map((t) => omitInternal(t))) as any,
        };
    },
    get: async ({ params, req }) => {
        try {
            const template = await getTemplate(params.templateId);
            if (!template || template.teamId !== (req as any).teamId) {
                return { status: 404, body: { error: "Template not found" } };
            }
            return {
                status: 200,
                body: serializeDates(omitInternal(template)) as any,
            };
        } catch (error) {
            if (error instanceof TemplateValidationError) {
                return {
                    status: 422,
                    body: {
                        error: error.message,
                        variables: error.variables,
                    },
                };
            }
            throw error;
        }
    },
    update: async ({ params, body, req }) => {
        try {
            const template = await updateTemplate({
                teamId: (req as any).teamId,
                templateId: params.templateId,
                title: body.title,
                content: body.content as any,
            });
            if (!template)
                return { status: 404, body: { error: "Template not found" } };
            return {
                status: 200,
                body: serializeDates(omitInternal(template)) as any,
            };
        } catch (err: any) {
            if (err.message === "duplicate_title") {
                return {
                    status: 409,
                    body: {
                        error: "A template with this title already exists",
                    },
                };
            }
            if (err instanceof TemplateValidationError) {
                return {
                    status: 422,
                    body: {
                        error: err.message,
                        variables: err.variables,
                    },
                };
            }
            throw err;
        }
    },
    duplicate: async ({ params, body, req }) => {
        try {
            const template = await duplicateTemplate({
                teamId: (req as any).teamId,
                templateId: params.templateId,
                title: body.title,
            });
            if (!template) {
                return { status: 404, body: { error: "Template not found" } };
            }
            return {
                status: 201,
                body: serializeDates(omitInternal(template)) as any,
            };
        } catch (error) {
            if (error instanceof TemplateValidationError) {
                return {
                    status: 422,
                    body: {
                        error: error.message,
                        variables: error.variables,
                    },
                };
            }
            throw error;
        }
    },
    remove: async ({ params, req }) => {
        await deleteTemplate((req as any).teamId, params.templateId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(restContract, restImpl, router);

export default router;
