import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    addMailToSequence,
    countSequences,
    createSequence,
    deleteMailFromSequence,
    getEmailSentCount,
    getSequenceBySequenceId,
    getSequenceClickThroughRate,
    getSequenceOpenRate,
    getSubscribers,
    getSubscribersCount,
    listSequences,
    pauseSequence,
    startSequence,
    updateMailInSequence,
    updateSequence,
    type HydratedSequence,
} from "./queries";
import { serializeDates } from "../utils/serialize";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

// `content`/`filter`/`report` are jsonb columns (typed `unknown` by Drizzle),
// looser than the contract's schema \u2014 same rationale as `templates/routes.ts`.
function toBody(sequence: HydratedSequence): any {
    return serializeDates(sequence);
}

const impl = s.router(contract.sequences, {
    create: async ({ body, req }) => {
        try {
            const sequence = await createSequence({
                teamId: (req as any).teamId,
                ...body,
            });
            return { status: 201, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    list: async ({ query, req }) => {
        const teamId = (req as any).teamId;
        const [items, total] = await Promise.all([
            listSequences({
                teamId,
                type: query.type,
                offset: query.offset,
                itemsPerPage: query.itemsPerPage,
            }),
            countSequences(teamId, query.type),
        ]);
        return { status: 200, body: { items: items.map(toBody), total } };
    },
    get: async ({ params, req }) => {
        const sequence = await getSequenceBySequenceId(
            (req as any).teamId,
            params.sequenceId,
        );
        if (!sequence)
            return { status: 404, body: { error: "Sequence not found" } };
        return { status: 200, body: toBody(sequence) };
    },
    update: async ({ params, body, req }) => {
        const sequence = await updateSequence({
            teamId: (req as any).teamId,
            sequenceId: params.sequenceId,
            ...body,
        } as any);
        if (!sequence)
            return { status: 404, body: { error: "Sequence not found" } };
        return { status: 200, body: toBody(sequence) };
    },
    addEmail: async ({ params, body, req }) => {
        try {
            const sequence = await addMailToSequence({
                teamId: (req as any).teamId,
                sequenceId: params.sequenceId,
                templateId: body.templateId,
            });
            if (!sequence)
                return { status: 404, body: { error: "Sequence not found" } };
            return { status: 201, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    updateEmail: async ({ params, body, req }) => {
        try {
            const sequence = await updateMailInSequence({
                teamId: (req as any).teamId,
                sequenceId: params.sequenceId,
                emailId: params.emailId,
                ...body,
            });
            if (!sequence)
                return { status: 404, body: { error: "Sequence not found" } };
            return { status: 200, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    removeEmail: async ({ params, req }) => {
        try {
            const sequence = await deleteMailFromSequence({
                teamId: (req as any).teamId,
                sequenceId: params.sequenceId,
                emailId: params.emailId,
            });
            if (!sequence)
                return { status: 404, body: { error: "Sequence not found" } };
            return { status: 200, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    start: async ({ params, req }) => {
        try {
            const sequence = await startSequence({
                teamId: (req as any).teamId,
                sequenceId: params.sequenceId,
            });
            return { status: 200, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    pause: async ({ params, req }) => {
        try {
            const sequence = await pauseSequence({
                teamId: (req as any).teamId,
                sequenceId: params.sequenceId,
            });
            return { status: 200, body: toBody(sequence) };
        } catch (err: any) {
            return { status: 400, body: { error: err.message } };
        }
    },
    stats: async ({ params }) => {
        const { sequenceId } = params;
        const [sent, openRate, clickThroughRate, subscribersCount] =
            await Promise.all([
                getEmailSentCount(sequenceId),
                getSequenceOpenRate(sequenceId),
                getSequenceClickThroughRate(sequenceId),
                getSubscribersCount(sequenceId),
            ]);
        return {
            status: 200,
            body: { sent, openRate, clickThroughRate, subscribersCount },
        };
    },
    subscribers: async ({ params, query }) => {
        const subscribers = await getSubscribers({
            sequenceId: params.sequenceId,
            page: query.page,
            limit: query.limit,
        });
        return { status: 200, body: subscribers };
    },
});

createExpressEndpoints(contract.sequences, impl, router);

export default router;
