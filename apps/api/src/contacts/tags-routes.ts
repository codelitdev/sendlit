import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { deleteTag, getTagReferences, listTags, renameTag } from "./tags-queries";

const router = Router();
router.use("/tags", requireAuth, requireTeam);

const s = initServer();

const impl = s.router(contract.tags, {
  list: async ({ req }) => ({
    status: 200,
    body: { items: await listTags((req as any).teamId) },
  }),
  references: async ({ params, req }) => ({
    status: 200,
    body: await getTagReferences((req as any).teamId, params.tag),
  }),
  rename: async ({ params, body, req }) => {
    const result = await renameTag((req as any).teamId, params.tag, body.name);
    if (result === "tag_not_found") return { status: 404, body: { error: result } };
    if (result === "tag_unchanged") return { status: 400, body: { error: result } };
    return { status: 200, body: result };
  },
  remove: async ({ params, req }) => {
    const result = await deleteTag((req as any).teamId, params.tag);
    if (!result) return { status: 404, body: { error: "tag_not_found" } };
    return { status: 200, body: result };
  },
});

createExpressEndpoints(contract.tags, impl, router);

export default router;
