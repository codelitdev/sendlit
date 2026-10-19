import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
  createForm,
  deleteForm,
  getForm,
  listForms,
  toPublicForm,
  updateForm,
} from "./queries";

const router = Router();
router.use("/forms", requireAuth, requireTeam);

const s = initServer();

const impl = s.router(contract.forms, {
  list: async ({ req }) => ({
    status: 200,
    body: { items: (await listForms((req as any).teamId)).map(toPublicForm) },
  }),
  create: async ({ body, req }) => ({
    status: 201,
    body: toPublicForm(await createForm((req as any).teamId, body)),
  }),
  get: async ({ params, req }) => {
    const form = await getForm((req as any).teamId, params.formId);
    if (!form) return { status: 404, body: { error: "Form not found" } };
    return { status: 200, body: toPublicForm(form) };
  },
  update: async ({ params, body, req }) => {
    const form = await updateForm((req as any).teamId, params.formId, body);
    if (!form) return { status: 404, body: { error: "Form not found" } };
    return { status: 200, body: toPublicForm(form) };
  },
  remove: async ({ params, req }) => {
    if (!(await deleteForm((req as any).teamId, params.formId))) {
      return { status: 404, body: { error: "Form not found" } };
    }
    return { status: 204, body: undefined };
  },
});

createExpressEndpoints(contract.forms, impl, router);

export default router;
