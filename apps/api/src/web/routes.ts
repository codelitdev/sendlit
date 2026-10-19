import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
  getIssue,
  getWebSettings,
  listIssues,
  updateWebSettings,
  WebPublishingError,
} from "./queries";

const router = Router();
router.use(["/settings/web", "/web/issues"], requireAuth, requireTeam);

const s = initServer();

const settingsImpl = s.router(contract.settings.web, {
  get: async ({ req }) => ({
    status: 200,
    body: await getWebSettings((req as any).teamId),
  }),
  update: async ({ body, req }) => {
    try {
      return { status: 200, body: await updateWebSettings((req as any).teamId, body) };
    } catch (error) {
      if (error instanceof WebPublishingError && error.status !== 404) {
        return { status: error.status, body: { error: error.message } };
      }
      throw error;
    }
  },
});

const issuesImpl = s.router(contract.web, {
  list: async ({ query, req }) => ({
    status: 200,
    body: await listIssues((req as any).teamId, query),
  }),
  get: async ({ params, req }) => {
    const issue = await getIssue((req as any).teamId, params.slug);
    if (!issue) return { status: 404, body: { error: "Issue not found" } };
    return { status: 200, body: issue };
  },
});

createExpressEndpoints(contract.settings.web, settingsImpl, router);
createExpressEndpoints(contract.web, issuesImpl, router);

export default router;
