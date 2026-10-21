import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
  createForm,
  deleteForm,
  FormSenderError,
  getForm,
  listForms,
  toPublicForms,
  updateForm,
} from "./queries";

const router = Router();
router.use("/forms", requireAuth, requireTeam);

const s = initServer();

/** Double opt-in needs a sender; tell the client why it was refused. */
async function senderGuard<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    if (!(error instanceof FormSenderError)) throw error;
    return {
      ok: false as const,
      response: {
        status: 422 as const,
        body: {
          error: "confirmation_sender_unavailable" as const,
          message: error.issue,
        },
      },
    };
  }
}

const impl = s.router(contract.forms, {
  list: async ({ req }) => {
    const teamId = (req as any).teamId;
    return {
      status: 200,
      body: { items: await toPublicForms(teamId, await listForms(teamId)) },
    };
  },
  create: async ({ body, req }) => {
    const teamId = (req as any).teamId;
    const result = await senderGuard(() => createForm(teamId, body));
    if (!result.ok) return result.response;
    return { status: 201, body: (await toPublicForms(teamId, [result.value]))[0] };
  },
  get: async ({ params, req }) => {
    const teamId = (req as any).teamId;
    const form = await getForm(teamId, params.formId);
    if (!form) return { status: 404, body: { error: "Form not found" } };
    return { status: 200, body: (await toPublicForms(teamId, [form]))[0] };
  },
  update: async ({ params, body, req }) => {
    const teamId = (req as any).teamId;
    const result = await senderGuard(() => updateForm(teamId, params.formId, body));
    if (!result.ok) return result.response;
    if (!result.value) return { status: 404, body: { error: "Form not found" } };
    return { status: 200, body: (await toPublicForms(teamId, [result.value]))[0] };
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
