import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { getMediaUploadSignature } from "./service";
import {
    countMedia,
    deleteUnusedMedia,
    getMediaByMediaId,
    listMedia,
    listMediaReferences,
    updateMediaMetadata,
} from "./queries";
import { omitInternal } from "../utils/public";
import { serializeDates } from "../utils/serialize";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

const impl = s.router(contract.media, {
    list: async ({ query, req }: any) => {
        const teamId = (req as any).teamId;
        const [items, total] = await Promise.all([
            listMedia({
                teamId,
                query: query.query,
                page: query.page,
                pageSize: query.pageSize,
            }),
            countMedia({ teamId, query: query.query }),
        ]);

        return {
            status: 200,
            body: {
                items: serializeDates(items.map((item) => omitInternal(item))),
                total,
            },
        };
    },
    presigned: async ({ req }) => {
        try {
            const result = await getMediaUploadSignature((req as any).teamId);
            return { status: 200, body: result };
        } catch {
            return {
                status: 500,
                body: { error: "Failed to create upload signature" },
            };
        }
    },
    get: async ({ params, req }: any) => {
        const item = await getMediaByMediaId(
            (req as any).teamId,
            params.mediaId,
        );
        if (!item) return { status: 404, body: { error: "Media not found" } };
        return { status: 200, body: serializeDates(omitInternal(item)) };
    },
    update: async ({ params, body, req }: any) => {
        const item = await updateMediaMetadata({
            teamId: (req as any).teamId,
            mediaId: params.mediaId,
            alt: body.alt,
            caption: body.caption,
        });
        if (!item) return { status: 404, body: { error: "Media not found" } };
        return { status: 200, body: serializeDates(omitInternal(item)) };
    },
    remove: async ({ params, req }: any) => {
        const result = await deleteUnusedMedia(
            (req as any).teamId,
            params.mediaId,
        );
        if (result === "not_found") {
            return { status: 404, body: { error: "Media not found" } };
        }
        if (result === "in_use") {
            return { status: 409, body: { error: "Media is still in use" } };
        }
        return { status: 204, body: undefined };
    },
    references: async ({ params, req }: any) => {
        const references = await listMediaReferences({
            teamId: (req as any).teamId,
            mediaId: params.mediaId,
        });
        if (!references) {
            return { status: 404, body: { error: "Media not found" } };
        }

        return {
            status: 200,
            body: {
                items: serializeDates(
                    references.map((reference) => ({
                        resourceType: reference.resourceType as
                            "TEMPLATE" | "SEQUENCE_EMAIL",
                        resourcePublicId: reference.resourcePublicId,
                        parentResourcePublicId:
                            reference.parentResourcePublicId,
                        createdAt: reference.createdAt,
                        updatedAt: reference.updatedAt,
                    })),
                ),
            },
        };
    },
});

createExpressEndpoints(contract.media, impl, router);

export default router;
