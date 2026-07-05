import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
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
import { serializeDates } from "../utils/serialize";

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
        return { status: 201, body: serializeDates(contact) };
    },
    list: async ({ query, req }) => {
        const teamId = (req as any).teamId;
        const [items, total] = await Promise.all([
            listContacts({
                teamId,
                searchText: query.q,
                offset: query.offset,
                rowsPerPage: query.rowsPerPage,
            }),
            countContacts(teamId),
        ]);
        return { status: 200, body: { items: serializeDates(items), total } };
    },
    get: async ({ params, req }) => {
        const contact = await getContactByContactId(params.contactId);
        if (!contact || contact.teamId !== (req as any).teamId) {
            return { status: 404, body: { error: "Contact not found" } };
        }
        return { status: 200, body: serializeDates(contact) };
    },
    update: async ({ params, body, req }) => {
        const contact = await updateContact(
            (req as any).teamId,
            params.contactId,
            body,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(contact) };
    },
    addTag: async ({ params, req }) => {
        const contact = await addTagToContact(
            (req as any).teamId,
            params.contactId,
            params.tag,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(contact) };
    },
    removeTag: async ({ params, req }) => {
        const contact = await removeTagFromContact(
            (req as any).teamId,
            params.contactId,
            params.tag,
        );
        if (!contact)
            return { status: 404, body: { error: "Contact not found" } };
        return { status: 200, body: serializeDates(contact) };
    },
    deliveries: async ({ params, req }) => {
        const teamId = (req as any).teamId;
        const contact = await getContactByContactId(params.contactId);
        if (!contact || contact.teamId !== teamId) {
            return { status: 404, body: { error: "Contact not found" } };
        }
        const deliveries = await getDeliveriesByContact(
            teamId,
            params.contactId,
        );
        return { status: 200, body: serializeDates(deliveries) };
    },
    remove: async ({ params, req }) => {
        await deleteContact((req as any).teamId, params.contactId);
        return { status: 204, body: undefined };
    },
});

createExpressEndpoints(contract.contacts, impl, router);

export default router;
