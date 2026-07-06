import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    createSegment,
    deleteSegment,
    getSegment,
    listSegments,
    updateSegment,
} from "./segments-queries";
import { serializeDates } from "../utils/serialize";
import { omitInternal } from "../utils/public";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

const impl = s.router(contract.segments, {
    create: async ({ body, req }) => {
        try {
            const segment = await createSegment({
                teamId: (req as any).teamId,
                name: body.name,
                filter: body.filter,
            });
            return {
                status: 201,
                body: serializeDates(omitInternal(segment)) as any,
            };
        } catch (err: any) {
            if (err.message === "duplicate_name") {
                return {
                    status: 409,
                    body: { error: "A segment with this name already exists" },
                };
            }
            throw err;
        }
    },
    list: async ({ req }) => {
        const items = await listSegments((req as any).teamId);
        return {
            status: 200,
            body: serializeDates(
                items.map((item) => omitInternal(item)),
            ) as any,
        };
    },
    get: async ({ params, req }) => {
        const segment = await getSegment(params.segmentId);
        if (!segment || segment.teamId !== (req as any).teamId) {
            return { status: 404, body: { error: "Segment not found" } };
        }
        return {
            status: 200,
            body: serializeDates(omitInternal(segment)) as any,
        };
    },
    update: async ({ params, body, req }) => {
        try {
            const segment = await updateSegment({
                teamId: (req as any).teamId,
                segmentId: params.segmentId,
                name: body.name,
                filter: body.filter,
            });
            if (!segment)
                return { status: 404, body: { error: "Segment not found" } };
            return {
                status: 200,
                body: serializeDates(omitInternal(segment)) as any,
            };
        } catch (err: any) {
            if (err.message === "duplicate_name") {
                return {
                    status: 409,
                    body: { error: "A segment with this name already exists" },
                };
            }
            throw err;
        }
    },
    remove: async ({ params, req }) => {
        await deleteSegment((req as any).teamId, params.segmentId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.segments, impl, router);

export default router;
