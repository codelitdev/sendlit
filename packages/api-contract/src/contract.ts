import { z } from "zod";
import { initContract } from "@ts-rest/core";
import { errorSchema, itemsList, paginated } from "./schemas/common";
import {
    contactDeliverySchema,
    contactSchema,
    createContactBodySchema,
    listContactsQuerySchema,
    updateContactBodySchema,
} from "./schemas/contacts";
import {
    createTemplateBodySchema,
    emailTemplateSchema,
    systemTemplateSchema,
    updateTemplateBodySchema,
} from "./schemas/templates";
import {
    addSequenceEmailBodySchema,
    createSequenceBodySchema,
    listSequencesQuerySchema,
    listSubscribersQuerySchema,
    sequenceSchema,
    sequenceStatsSchema,
    updateSequenceBodySchema,
    updateSequenceEmailBodySchema,
} from "./schemas/sequences";
import {
    createEspConfigBodySchema,
    espConfigSchema,
    testEspConfigBodySchema,
    testEspConfigResponseSchema,
    updateEspConfigBodySchema,
    upsertEspConfigBodySchema,
} from "./schemas/esp";
import {
    generalSettingsSchema,
    updateGeneralSettingsBodySchema,
} from "./schemas/settings";
import {
    apiKeySchema,
    createApiKeyBodySchema,
    createdApiKeySchema,
    createTeamBodySchema,
    provisionTeamBodySchema,
    provisionTeamResponseSchema,
    renameTeamBodySchema,
    teamSchema,
} from "./schemas/teams";
import {
    createSegmentBodySchema,
    segmentSchema,
    updateSegmentBodySchema,
} from "./schemas/segments";
import {
    listMediaQuerySchema,
    mediaReferenceSchema,
    mediaSchema,
    mediaUploadSignatureSchema,
    updateMediaBodySchema,
} from "./schemas/media";
import {
    listTransactionalEmailsQuerySchema,
    sendEmailBodySchema,
    sendEmailResponseSchema,
    transactionalEmailDetailSchema,
    transactionalEmailSchema,
} from "./schemas/transactional";
import { overviewSchema } from "./schemas/overview";
import {
    feedbackConnectionSchema,
    testFeedbackConnectionResponseSchema,
    upsertFeedbackConnectionBodySchema,
} from "./schemas/feedback";
import {
    deliveryEventSchema,
    listDeliveryEventsQuerySchema,
} from "./schemas/delivery-events";
import {
    listSuppressionsQuerySchema,
    releaseSuppressionBodySchema,
    suppressionSchema,
} from "./schemas/suppressions";

const c = initContract();

/**
 * Every route mirrors the previously hand-maintained Express + swagger-autogen
 * endpoints 1:1 (same paths, methods and status codes) \u2014 this is the single
 * source of truth for request/response shapes now, consumed by:
 *  - `apps/api` (server-side validation via `@ts-rest/express`)
 *  - the OpenAPI document (`@ts-rest/open-api`'s `generateOpenApi`)
 *  - `apps/web`'s typed client (`@ts-rest/core`'s `initClient`)
 */
const contactsContract = c.router(
    {
        create: {
            method: "POST",
            path: "/contacts",
            body: createContactBodySchema,
            responses: { 201: contactSchema },
            summary: "Create a contact",
            description:
                "Creates a contact (subscriber). If a contact with the same email already exists for this team, the existing contact is returned.",
        },
        list: {
            method: "GET",
            path: "/contacts",
            query: listContactsQuerySchema,
            responses: {
                200: paginated(contactSchema),
                400: errorSchema,
                404: errorSchema,
            },
            summary: "List contacts",
            description:
                "Returns a paginated list of contacts. Pass filter as serialized ContactFilterWithAggregator JSON for inline filtering, or segmentId to only return contacts currently matching that saved segment's filter (404 if the segment doesn't exist). SendLit supports fixed generic contact filters over first-class fields, tags, and custom fields; client-specific concepts should be synced into namespaced tags or customFields. q, filter, and segmentId combine with AND. The response's total reflects the combined filters.",
        },
        get: {
            method: "GET",
            path: "/contacts/:contactId",
            responses: { 200: contactSchema, 404: errorSchema },
            summary: "Get a contact",
        },
        update: {
            method: "PATCH",
            path: "/contacts/:contactId",
            body: updateContactBodySchema,
            responses: { 200: contactSchema, 404: errorSchema },
            summary: "Update a contact",
        },
        addTag: {
            method: "POST",
            path: "/contacts/:contactId/tags/:tag",
            body: c.noBody(),
            responses: { 200: contactSchema, 404: errorSchema },
            summary: "Add a tag to a contact",
        },
        removeTag: {
            method: "DELETE",
            path: "/contacts/:contactId/tags/:tag",
            responses: { 200: contactSchema, 404: errorSchema },
            summary: "Remove a tag from a contact",
        },
        deliveries: {
            method: "GET",
            path: "/contacts/:contactId/deliveries",
            responses: {
                200: c.type<z.infer<typeof contactDeliverySchema>[]>(),
                404: errorSchema,
            },
            summary: "List broadcasts/sequence emails delivered to a contact",
        },
        remove: {
            method: "DELETE",
            path: "/contacts/:contactId",
            responses: { 204: c.noBody() },
            summary: "Delete a contact",
        },
    },
    { metadata: { tag: "Contacts" } },
);

/**
 * A saved, named, reusable contact filter — lets a team build a
 * `ContactFilterWithAggregator` once (see `contacts/segment.ts`) and reuse it
 * across broadcasts/sequences instead of re-building it inline every time.
 * Top-level `/segments` resource (matching Klaviyo/SendGrid/Customer.io —
 * team scope comes from auth, not the URL).
 */
const segmentsContract = c.router(
    {
        create: {
            method: "POST",
            path: "/segments",
            body: createSegmentBodySchema,
            responses: { 201: segmentSchema, 409: errorSchema },
            summary: "Create a saved segment",
        },
        list: {
            method: "GET",
            path: "/segments",
            responses: { 200: c.type<z.infer<typeof segmentSchema>[]>() },
            summary: "List saved segments",
        },
        get: {
            method: "GET",
            path: "/segments/:segmentId",
            responses: { 200: segmentSchema, 404: errorSchema },
            summary: "Get a saved segment",
        },
        update: {
            method: "PATCH",
            path: "/segments/:segmentId",
            body: updateSegmentBodySchema,
            responses: {
                200: segmentSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Update a saved segment",
        },
        remove: {
            method: "DELETE",
            path: "/segments/:segmentId",
            responses: { 204: c.noBody() },
            summary: "Delete a saved segment",
        },
    },
    { metadata: { tag: "Segments" } },
);

const mediaContract = c.router(
    {
        list: {
            method: "GET",
            path: "/media",
            query: listMediaQuerySchema,
            responses: { 200: paginated(mediaSchema) },
            summary: "List uploaded media",
            description:
                "Returns the team's uploaded MediaLit-backed media. Unsplash and external URL images are not stored here.",
        },
        presigned: {
            method: "POST",
            path: "/media/presigned",
            body: c.noBody(),
            responses: { 200: mediaUploadSignatureSchema, 500: errorSchema },
            summary: "Generate a MediaLit upload signature",
            description:
                "Returns a short-lived MediaLit signature and endpoint. Upload image files directly to `${endpoint}/media/create/resumable` with the signature in the `x-medialit-signature` header.",
        },
        get: {
            method: "GET",
            path: "/media/:mediaId",
            responses: { 200: mediaSchema, 404: errorSchema },
            summary: "Get uploaded media",
        },
        update: {
            method: "PATCH",
            path: "/media/:mediaId",
            body: updateMediaBodySchema,
            responses: { 200: mediaSchema, 404: errorSchema },
            summary: "Update uploaded media metadata",
        },
        remove: {
            method: "DELETE",
            path: "/media/:mediaId",
            responses: {
                204: c.noBody(),
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Delete unused uploaded media",
            description:
                "Deletes the MediaLit file and SendLit media row only when no saved email content references it.",
        },
        references: {
            method: "GET",
            path: "/media/:mediaId/references",
            responses: {
                200: itemsList(mediaReferenceSchema),
                404: errorSchema,
            },
            summary: "List uploaded media references",
        },
    },
    { metadata: { tag: "Media" } },
);

const templatesContract = c.router(
    {
        listSystem: {
            method: "GET",
            path: "/system-templates",
            responses: { 200: itemsList(systemTemplateSchema) },
            summary: "List built-in starting templates",
            description:
                "Not team-scoped \u2014 the same for every team. Offered alongside a team's own templates when creating a template, broadcast, sequence, or adding an email to a sequence.",
        },
        create: {
            method: "POST",
            path: "/templates",
            body: createTemplateBodySchema,
            responses: { 201: emailTemplateSchema },
            summary: "Create an email template",
        },
        list: {
            method: "GET",
            path: "/templates",
            responses: { 200: c.type<z.infer<typeof emailTemplateSchema>[]>() },
            summary: "List email templates",
        },
        get: {
            method: "GET",
            path: "/templates/:templateId",
            responses: { 200: emailTemplateSchema, 404: errorSchema },
            summary: "Get an email template",
        },
        update: {
            method: "PATCH",
            path: "/templates/:templateId",
            body: updateTemplateBodySchema,
            responses: {
                200: emailTemplateSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Update an email template",
        },
        remove: {
            method: "DELETE",
            path: "/templates/:templateId",
            responses: { 204: c.noBody() },
            summary: "Delete an email template",
        },
    },
    { metadata: { tag: "Templates" } },
);

const sequencesContract = c.router(
    {
        create: {
            method: "POST",
            path: "/sequences",
            body: createSequenceBodySchema,
            responses: { 201: sequenceSchema, 400: errorSchema },
            summary: "Create a broadcast or a sequence",
        },
        list: {
            method: "GET",
            path: "/sequences",
            query: listSequencesQuerySchema,
            responses: { 200: paginated(sequenceSchema) },
            summary: "List broadcasts or sequences",
        },
        get: {
            method: "GET",
            path: "/sequences/:sequenceId",
            responses: { 200: sequenceSchema, 404: errorSchema },
            summary: "Get a broadcast or sequence",
        },
        update: {
            method: "PATCH",
            path: "/sequences/:sequenceId",
            body: updateSequenceBodySchema,
            responses: {
                200: sequenceSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary: "Update a broadcast or sequence",
        },
        remove: {
            method: "DELETE",
            path: "/sequences/:sequenceId",
            responses: { 204: c.noBody(), 404: errorSchema },
            summary: "Delete a broadcast or sequence",
        },
        addEmail: {
            method: "POST",
            path: "/sequences/:sequenceId/emails",
            body: addSequenceEmailBodySchema,
            responses: {
                201: sequenceSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary: "Add an email to a sequence",
        },
        updateEmail: {
            method: "PATCH",
            path: "/sequences/:sequenceId/emails/:emailId",
            body: updateSequenceEmailBodySchema,
            responses: {
                200: sequenceSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary: "Update an email within a sequence",
        },
        removeEmail: {
            method: "DELETE",
            path: "/sequences/:sequenceId/emails/:emailId",
            responses: {
                200: sequenceSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary: "Remove an email from a sequence",
        },
        start: {
            method: "POST",
            path: "/sequences/:sequenceId/start",
            body: c.noBody(),
            responses: {
                200: sequenceSchema,
                400: errorSchema,
                422: errorSchema,
            },
            summary: "Start a broadcast or activate a sequence",
        },
        pause: {
            method: "POST",
            path: "/sequences/:sequenceId/pause",
            body: c.noBody(),
            responses: { 200: sequenceSchema, 400: errorSchema },
            summary: "Pause an active sequence",
        },
        stats: {
            method: "GET",
            path: "/sequences/:sequenceId/stats",
            responses: { 200: sequenceStatsSchema },
            summary:
                "Delivery / open-rate / click-through-rate stats for a sequence",
        },
        subscribers: {
            method: "GET",
            path: "/sequences/:sequenceId/subscribers",
            query: listSubscribersQuerySchema,
            responses: { 200: c.type<string[]>() },
            summary: "List contact ids that have received this sequence",
        },
    },
    { metadata: { tag: "Sequences" } },
);

/**
 * Single API-triggered sends — the transactional counterpart of
 * `sequencesContract` (see `docs/transactional-emails.md` for why this is a
 * separate resource rather than a `sequences` variant). `send` is
 * fire-and-forget (`202`); `get`/`list` are how a caller polls status or a
 * dashboard log page reads the send history.
 */
const transactionalContract = c.router(
    {
        send: {
            method: "POST",
            path: "/emails",
            body: sendEmailBodySchema,
            responses: {
                202: sendEmailResponseSchema,
                400: errorSchema,
                422: errorSchema,
                429: errorSchema,
            },
            summary: "Send a transactional email",
        },
        get: {
            method: "GET",
            path: "/emails/:txeId",
            responses: {
                200: transactionalEmailDetailSchema,
                404: errorSchema,
            },
            summary: "Get a transactional email",
        },
        list: {
            method: "GET",
            path: "/emails",
            query: listTransactionalEmailsQuerySchema,
            responses: { 200: paginated(transactionalEmailSchema) },
            summary: "List transactional emails",
        },
    },
    { metadata: { tag: "Transactional Emails" } },
);

/**
 * Backward-compatible singleton alias over the team's *default* user-managed
 * ESP (get/upsert/remove/test) — the pre-multi-ESP shape, kept so existing
 * integrations don't break. New integrations should prefer the collection
 * contract below (`espCollectionContract`, `/settings/esps`), which supports
 * multiple team-scoped configurations. Both are nested under `settings`
 * rather than sitting as a sibling top-level group, alongside future
 * per-team settings (e.g. branding).
 */
const espSettingsContract = c.router(
    {
        get: {
            method: "GET",
            path: "/settings/esp",
            responses: { 200: espConfigSchema.nullable() },
            summary: "Get the team's ESP configuration",
            description:
                "Returns the team's configured email sending provider. Never includes the password/secret.",
        },
        upsert: {
            method: "PUT",
            path: "/settings/esp",
            body: upsertEspConfigBodySchema,
            responses: { 200: espConfigSchema },
            summary: "Create or update the team's ESP configuration",
            description:
                "Omit password to keep the existing secret unchanged; send an empty string to clear it.",
        },
        remove: {
            method: "DELETE",
            path: "/settings/esp",
            responses: { 204: c.noBody(), 409: errorSchema },
            summary:
                "Remove the team's ESP configuration (future campaign sends fail until a new ESP is configured)",
        },
        test: {
            method: "POST",
            path: "/settings/esp/test",
            body: testEspConfigBodySchema,
            responses: {
                200: testEspConfigResponseSchema,
                400: errorSchema,
                502: testEspConfigResponseSchema,
            },
            summary: "Send a test email through the team's configured ESP",
            description:
                "Sends to the given address, or the current user's own email if omitted. Always attempts real delivery.",
        },
    },
    { metadata: { tag: "Settings" } },
);

const espCollectionContract = c.router(
    {
        list: {
            method: "GET",
            path: "/settings/esps",
            responses: { 200: itemsList(espConfigSchema) },
            summary: "List the team's user-managed ESP configurations",
        },
        create: {
            method: "POST",
            path: "/settings/esps",
            body: createEspConfigBodySchema,
            responses: { 201: espConfigSchema },
            summary: "Create a user-managed ESP configuration",
        },
        get: {
            method: "GET",
            path: "/settings/esps/:espId",
            responses: { 200: espConfigSchema, 404: errorSchema },
            summary: "Get a user-managed ESP configuration",
        },
        update: {
            method: "PATCH",
            path: "/settings/esps/:espId",
            body: updateEspConfigBodySchema,
            responses: { 200: espConfigSchema, 404: errorSchema },
            summary: "Update a user-managed ESP configuration",
        },
        remove: {
            method: "DELETE",
            path: "/settings/esps/:espId",
            responses: {
                204: c.noBody(),
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Remove a user-managed ESP configuration",
        },
        test: {
            method: "POST",
            path: "/settings/esps/:espId/test",
            body: testEspConfigBodySchema,
            responses: {
                200: testEspConfigResponseSchema,
                400: errorSchema,
                404: errorSchema,
                502: testEspConfigResponseSchema,
            },
            summary: "Send a test email through a user-managed ESP",
        },
    },
    { metadata: { tag: "Settings" } },
);

/** General workspace settings — same per-team singleton shape as ESP
 * settings (get/upsert via `/settings/general`, no ids exposed). */
const generalSettingsContract = c.router(
    {
        get: {
            method: "GET",
            path: "/settings/general",
            responses: { 200: generalSettingsSchema },
            summary: "Get the team's general settings",
            description:
                "Returns defaults (all-null fields) when nothing has been saved yet.",
        },
        update: {
            method: "PUT",
            path: "/settings/general",
            body: updateGeneralSettingsBodySchema,
            responses: { 200: generalSettingsSchema },
            summary: "Update the team's general settings",
            description:
                "Omitted fields are left unchanged; send an empty string to clear a field.",
        },
    },
    { metadata: { tag: "Settings" } },
);

const settingsContract = c.router({
    esp: espSettingsContract,
    esps: espCollectionContract,
    general: generalSettingsContract,
});

const teamsContract = c.router(
    {
        list: {
            method: "GET",
            path: "/teams",
            responses: { 200: itemsList(teamSchema) },
            summary: "List the teams the current account belongs to",
        },
        create: {
            method: "POST",
            path: "/teams",
            body: createTeamBodySchema,
            responses: { 201: teamSchema },
            summary: "Create a new team",
        },
        rename: {
            method: "PATCH",
            path: "/teams/:teamId",
            body: renameTeamBodySchema,
            responses: { 200: teamSchema, 404: errorSchema },
            summary: "Rename a team",
        },
        remove: {
            method: "DELETE",
            path: "/teams/:teamId",
            responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
            summary:
                "Delete a team and everything scoped to it (contacts, templates, sequences, ...)",
        },
        listKeys: {
            method: "GET",
            path: "/teams/:teamId/keys",
            responses: { 200: itemsList(apiKeySchema), 404: errorSchema },
            summary: "List a team's API keys",
        },
        createKey: {
            method: "POST",
            path: "/teams/:teamId/keys",
            body: createApiKeyBodySchema,
            responses: { 201: createdApiKeySchema, 404: errorSchema },
            summary: "Create a new API key for a team",
            description:
                "The response's `key` field is the full secret and is only ever returned once — store it securely. Subsequent listings only expose the key's prefix.",
        },
        removeKey: {
            method: "DELETE",
            path: "/teams/:teamId/keys/:keyId",
            responses: { 204: c.noBody(), 404: errorSchema },
            summary: "Revoke an API key by its id",
        },
    },
    { metadata: { tag: "Teams" } },
);

const provisioningContract = c.router(
    {
        provisionTeam: {
            method: "POST",
            path: "/provisioning/teams",
            body: provisionTeamBodySchema,
            responses: {
                200: provisionTeamResponseSchema,
                400: errorSchema,
                401: errorSchema,
                500: errorSchema,
            },
            summary: "Find-or-create a team for a consumer-supplied tenant id",
            description:
                "Server-to-server endpoint for multi-tenant consumers (e.g. CourseLit) to provision one SendLit team per one of their own tenants. Requires the X-Sendlit-Provisioning-Secret header.",
        },
    },
    { metadata: { tag: "Teams" } },
);

const overviewContract = c.router(
    {
        get: {
            method: "GET",
            path: "/overview",
            responses: { 200: overviewSchema },
            summary: "Get team overview metrics",
        },
    },
    { metadata: { tag: "Overview" } },
);

/**
 * A user-managed ESP's delivery-feedback (bounce/complaint webhook)
 * configuration — a collection-aware subresource keyed by `espId`, never a
 * `/settings/esp/feedback` singleton alias (see
 * `docs/bounces-and-complaints.md#10-configuration-and-web-ux`). Only
 * providers with a reviewed adapter (`feedbackCapableProviders`) can be
 * configured; every route validates the ESP belongs to the active team and
 * never exposes a platform (deployment-managed) connection.
 */
const feedbackContract = c.router(
    {
        get: {
            method: "GET",
            path: "/settings/esps/:espId/feedback",
            responses: {
                200: feedbackConnectionSchema.nullable(),
                404: errorSchema,
            },
            summary: "Get a user ESP's delivery-feedback connection",
            description:
                "Returns null when feedback hasn't been configured for this ESP yet.",
        },
        upsert: {
            method: "PUT",
            path: "/settings/esps/:espId/feedback",
            body: upsertFeedbackConnectionBodySchema,
            responses: {
                200: feedbackConnectionSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary:
                "Create or rotate a user ESP's delivery-feedback connection",
            description:
                "Creates the connection (and its stable webhook URL) on first call; a later call rotates the credential without changing the URL. The provider is always the ESP's current provider, not client-writable.",
        },
        rotate: {
            method: "POST",
            path: "/settings/esps/:espId/feedback/rotate",
            body: upsertFeedbackConnectionBodySchema,
            responses: {
                200: feedbackConnectionSchema,
                400: errorSchema,
                404: errorSchema,
            },
            summary: "Rotate an existing feedback connection's credential",
            description:
                "Same effect as PUT, but fails with 404 if no connection exists yet. The previous credential remains valid for 24h so in-flight provider retries aren't lost.",
        },
        test: {
            method: "POST",
            path: "/settings/esps/:espId/feedback/test",
            body: c.noBody(),
            responses: {
                200: testFeedbackConnectionResponseSchema,
                404: errorSchema,
            },
            summary: "Verify a feedback connection's stored credential",
        },
        remove: {
            method: "DELETE",
            path: "/settings/esps/:espId/feedback",
            responses: { 204: c.noBody(), 404: errorSchema },
            summary: "Disable a user ESP's delivery-feedback connection",
        },
    },
    { metadata: { tag: "Settings" } },
);

/** Read-only normalized delivery-event history — see
 * `docs/bounces-and-complaints.md#5-canonical-delivery-events`. */
const deliveryEventsContract = c.router(
    {
        list: {
            method: "GET",
            path: "/delivery-events",
            query: listDeliveryEventsQuerySchema,
            responses: { 200: paginated(deliveryEventSchema) },
            summary: "List normalized delivery events for the team",
        },
        get: {
            method: "GET",
            path: "/delivery-events/:eventId",
            responses: { 200: deliveryEventSchema, 404: errorSchema },
            summary: "Get a single normalized delivery event",
        },
    },
    { metadata: { tag: "Delivery" } },
);

/** Per-workspace do-not-send list — see
 * `docs/bounces-and-complaints.md#8-suppression-model`. Workspace-wide and
 * route-independent; intentionally has no ESP filter that changes
 * enforcement semantics. */
const suppressionsContract = c.router(
    {
        list: {
            method: "GET",
            path: "/suppressions",
            query: listSuppressionsQuerySchema,
            responses: { 200: paginated(suppressionSchema) },
            summary: "List the team's suppressed recipients",
        },
        get: {
            method: "GET",
            path: "/suppressions/:suppressionId",
            responses: { 200: suppressionSchema, 404: errorSchema },
            summary: "Get a single suppression",
        },
        release: {
            method: "POST",
            path: "/suppressions/:suppressionId/release",
            body: releaseSuppressionBodySchema,
            responses: {
                200: suppressionSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Release an active suppression",
            description:
                "A workspace owner may release hard_bounce, repeated_soft_bounce, and manual suppressions only. Complaint suppressions cannot be released through this endpoint (409 suppression_not_releasable) — see the PRD's reactivation policy.",
        },
    },
    { metadata: { tag: "Delivery" } },
);

export const contract = c.router({
    contacts: contactsContract,
    segments: segmentsContract,
    media: mediaContract,
    templates: templatesContract,
    sequences: sequencesContract,
    transactional: transactionalContract,
    settings: settingsContract,
    teams: teamsContract,
    provisioning: provisioningContract,
    overview: overviewContract,
    feedback: feedbackContract,
    deliveryEvents: deliveryEventsContract,
    suppressions: suppressionsContract,
});

export type Contract = typeof contract;
