import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import {
    contactFilterSchema,
    contract,
    parseContactFilterQueryParam,
} from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    addTagToContact,
    countContacts,
    createContact,
    deleteContact,
    getContactByContactId,
    getDeliveriesByContact,
    listContacts,
    removeTagFromContact,
    updateContact,
} from "./queries";
import { getSegment } from "./segments-queries";
import { serializeDates } from "../utils/serialize";
import { omitInternal } from "../utils/public";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

/**
 * Thin ts-rest adapter: every handler just extracts `params`/`query`/`body`
 * (already validated against `@sendlit/api-contract`), delegates to the
 * unchanged, framework-agnostic `./queries.ts` functions, and maps the result
 * to `{ status, body }`. No business logic lives here \u2014 if Express is ever
 * swapped for something else, only this file (and its siblings) would change.
 */
const impl = s.router(contract.contacts, {
    create: async ({ body, req }) => {
        const contact = await createContact({
            teamId: (req as any).teamId,
            ...body,
        });
        return { status: 201, body: serializeDates(omitInternal(contact)) };
    },
    list: async ({ query, req }) => {
        const teamId = (req as any).teamId;

        const filters = [];
        if (query.segmentId) {
            const segment = await getSegment(query.segmentId);
            if (!segment || segment.teamId !== teamId) {
                return { status: 404, body: { error: "Segment not found" } };
            }
            const parsedSegmentFilter = contactFilterSchema.safeParse(
                segment.filter,
            );
            if (!parsedSegmentFilter.success) {
                return {
                    status: 400,
                    body: { error: "Invalid segment filter" },
                };
            }
            filters.push(parsedSegmentFilter.data as any);
        }
        if (query.filter) {
            const parsedFilter = parseContactFilterQueryParam(query.filter);
            if (!parsedFilter.success) {
                return { status: 400, body: { error: "Invalid filter" } };
            }
            filters.push(parsedFilter.data as any);
        }
        const filter = filters.length ? filters : undefined;

        const [items, total] = await Promise.all([
            listContacts({
                teamId,
                searchText: query.q,
                filter,
                offset: query.offset,
                rowsPerPage: query.rowsPerPage,
            }),
            countContacts(teamId, { searchText: query.q, filter }),
        ]);
        return {
            status: 200,
            body: {
                items: serializeDates(items.map((item) => omitInternal(item))),
                total,
            },
        };
    },
    get: async ({ params, req }) => {
        const contact = await getContactByContactId(params.contactId);
        if (!contact || contact.teamId !== (req as any).teamId) {
            return { status: 404, body: { error: "Contact not found" } };
        }
        return { status: 200, body: serializeDates(omitInternal(contact)) };
    },
    update: async ({ params, body, req }) => {
        const contact = await updateContact(
            (req as any).teamId,
            params.contactId,
            body,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(omitInternal(contact)) };
    },
    addTag: async ({ params, req }) => {
        const contact = await addTagToContact(
            (req as any).teamId,
            params.contactId,
            params.tag,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(omitInternal(contact)) };
    },
    removeTag: async ({ params, req }) => {
        const contact = await removeTagFromContact(
            (req as any).teamId,
            params.contactId,
            params.tag,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(omitInternal(contact)) };
    },
    deliveries: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const contact = await getContactByContactId(params.contactId);
        if (!contact || contact.teamId !== teamId) {
            return { status: 404, body: { error: "Contact not found" } };
        }
        const deliveries = await getDeliveriesByContact(teamId, contact.id);
        return { status: 200, body: serializeDates(deliveries) };
    },
    remove: async ({ params, req }) => {
        await deleteContact((req as any).teamId, params.contactId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.contacts, impl, router);

export default router;
