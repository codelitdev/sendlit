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
    duplicateTemplateBodySchema,
    emailTemplateSchema,
    listTemplatesQuerySchema,
    systemTemplateSchema,
    templateNotMarketingErrorSchema,
    templateNotTransactionalErrorSchema,
    templateValidationErrorSchema,
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
    retireEspConfigBodySchema,
    testEspConfigBodySchema,
    testEspConfigResponseSchema,
    updateEspConfigBodySchema,
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
    provisionedTeamSchema,
    provisionedTeamUsageSchema,
    renameTeamBodySchema,
    teamSchema,
    updateProvisionedTeamBodySchema,
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
    missingTemplateVariablesErrorSchema,
    sendEmailBodySchema,
    sendEmailResponseSchema,
    transactionalEmailDetailSchema,
    transactionalEmailSchema,
} from "./schemas/transactional";
import { overviewQuerySchema, overviewSchema } from "./schemas/overview";
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
import {
    addOrganizationMemberBodySchema,
    createOrganizationApiKeyBodySchema,
    createOrganizationBodySchema,
    createdOrganizationApiKeySchema,
    organizationAuditEventSchema,
    organizationApiKeySchema,
    organizationMemberSchema,
    organizationSchema,
    updateOrganizationBodySchema,
    updateOrganizationMemberBodySchema,
    organizationUsageSchema,
    organizationMailActivityQuerySchema,
    organizationMailActivitySchema,
    organizationEnterTeamBodySchema,
    organizationEnterTeamResponseSchema,
} from "./schemas/organizations";
import {
    espGrantSchema,
    organizationDeliveryPolicySchema,
    sendingOptionSchema,
    teamDeliverySettingsSchema,
    transitionEspGrantBodySchema,
    updateOrganizationDeliveryPolicyBodySchema,
    updateTeamDeliverySettingsBodySchema,
    upsertEspGrantBodySchema,
} from "./schemas/delivery";

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
            query: listTemplatesQuerySchema,
            responses: { 200: itemsList(systemTemplateSchema) },
            summary: "List built-in starting templates",
            description:
                "Not team-scoped—the same for every team. Filter by purpose. System templates are starters and must be duplicated into a team-owned template before transactional sending.",
        },
        create: {
            method: "POST",
            path: "/templates",
            body: createTemplateBodySchema,
            responses: {
                201: emailTemplateSchema,
                422: templateValidationErrorSchema,
            },
            summary: "Create an email template",
            description:
                "Purpose is immutable. Marketing content must contain exactly one final managed footer; transactional content must not contain a footer or marketing-only variables.",
        },
        list: {
            method: "GET",
            path: "/templates",
            query: listTemplatesQuerySchema,
            responses: { 200: c.type<z.infer<typeof emailTemplateSchema>[]>() },
            summary: "List email templates",
            description:
                "Returns team-owned templates with their immutable purpose and server-computed requiredVariables. Optionally filter by purpose.",
        },
        get: {
            method: "GET",
            path: "/templates/:templateId",
            responses: {
                200: emailTemplateSchema,
                404: errorSchema,
                422: templateValidationErrorSchema,
            },
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
                422: templateValidationErrorSchema,
            },
            summary: "Update an email template",
        },
        duplicate: {
            method: "POST",
            path: "/templates/:templateId/duplicate",
            body: duplicateTemplateBodySchema,
            responses: {
                201: emailTemplateSchema,
                404: errorSchema,
                422: templateValidationErrorSchema,
            },
            summary: "Duplicate an email template",
            description:
                "Creates a new team-owned copy with the same immutable purpose as the source template.",
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
            responses: {
                201: sequenceSchema,
                400: errorSchema,
                422: templateNotMarketingErrorSchema,
            },
            summary: "Create a broadcast or a sequence",
            description:
                "templateId must identify a marketing team template or marketing system starter. Transactional templates return 422 template_not_marketing.",
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
                422: templateNotMarketingErrorSchema,
            },
            summary: "Add an email to a sequence",
            description:
                "templateId must identify a marketing template; transactional templates return 422 template_not_marketing.",
        },
        updateEmail: {
            method: "PATCH",
            path: "/sequences/:sequenceId/emails/:emailId",
            body: updateSequenceEmailBodySchema,
            responses: {
                200: sequenceSchema,
                400: errorSchema,
                404: errorSchema,
                422: templateNotMarketingErrorSchema,
            },
            summary: "Update an email within a sequence",
            description:
                "When templateId is supplied, it must identify a marketing template; transactional templates return 422 template_not_marketing.",
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
            description:
                "Requires a non-empty mailing address in the team's general settings.",
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
                422: z.union([
                    missingTemplateVariablesErrorSchema,
                    templateNotTransactionalErrorSchema,
                    errorSchema,
                ]),
                429: errorSchema,
            },
            summary: "Send a transactional email",
            description:
                "Requires a non-empty mailing address in the team's general settings. `templateId` must identify a team-owned transactional template; marketing templates return 422 template_not_transactional. Unguarded Liquid variables must be supplied in `variables`, or the API returns 422 missing_template_variables without creating a row or queue job. Inline `html` is sent verbatim without Liquid rendering. address, unsubscribe_link, and subscriber are marketing-only server-owned values and are unavailable to transactional templates.",
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
            responses: { 201: espConfigSchema, 403: errorSchema },
            summary: "Create a user-managed ESP configuration",
        },
        get: {
            method: "GET",
            path: "/settings/esps/:espId",
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Get a user-managed ESP configuration",
        },
        update: {
            method: "PATCH",
            path: "/settings/esps/:espId",
            body: updateEspConfigBodySchema,
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Update a user-managed ESP configuration",
        },
        remove: {
            method: "DELETE",
            path: "/settings/esps/:espId",
            responses: {
                204: c.noBody(),
                403: errorSchema,
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
                403: errorSchema,
                422: errorSchema,
                404: errorSchema,
                502: testEspConfigResponseSchema,
            },
            summary: "Send a test email through a user-managed ESP",
            description:
                "Requires a non-empty mailing address in the team's general settings.",
        },
        activate: {
            method: "POST",
            path: "/settings/esps/:espId/activate",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
                422: errorSchema,
            },
            summary: "Activate a verified team ESP",
        },
        suspend: {
            method: "POST",
            path: "/settings/esps/:espId/suspend",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Suspend a team ESP",
        },
        resume: {
            method: "POST",
            path: "/settings/esps/:espId/resume",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Resume a team ESP",
        },
        retire: {
            method: "POST",
            path: "/settings/esps/:espId/retire",
            body: retireEspConfigBodySchema,
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Drain or cancel a team ESP",
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
    esps: espCollectionContract,
    general: generalSettingsContract,
});

const teamsContract = c.router(
    {
        list: {
            method: "GET",
            path: "/teams",
            responses: { 200: itemsList(teamSchema) },
            summary: "List the teams the current user belongs to",
        },
        create: {
            method: "POST",
            path: "/teams",
            body: createTeamBodySchema,
            responses: {
                201: teamSchema,
                403: errorSchema,
                409: errorSchema,
            },
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
            summary: "Archive a team",
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
                403: errorSchema,
                409: errorSchema,
                500: errorSchema,
            },
            summary: "Find-or-create a team for a consumer-supplied tenant id",
            description:
                "Server-to-server endpoint for multi-tenant consumers (e.g. CourseLit) to provision one SendLit team per tenant. Requires a scoped organization key as a Bearer token.",
        },
        getTeam: {
            method: "GET",
            path: "/provisioning/teams/:teamId",
            responses: {
                200: provisionedTeamSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary:
                "Get a provisioned team within the authenticated organization",
        },
        updateTeam: {
            method: "PATCH",
            path: "/provisioning/teams/:teamId",
            body: updateProvisionedTeamBodySchema,
            responses: {
                200: provisionedTeamSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Update a provisioned team's sender, limits, or settings",
        },
        createTeamKey: {
            method: "POST",
            path: "/provisioning/teams/:teamId/keys",
            body: createApiKeyBodySchema,
            responses: {
                201: createdApiKeySchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Replace a provisioned team's integration key",
        },
        suspendTeam: {
            method: "POST",
            path: "/provisioning/teams/:teamId/suspend",
            body: c.noBody(),
            responses: {
                200: provisionedTeamSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Suspend new sends for a provisioned team",
        },
        resumeTeam: {
            method: "POST",
            path: "/provisioning/teams/:teamId/resume",
            body: c.noBody(),
            responses: {
                200: provisionedTeamSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Resume sends for a provisioned team",
        },
        archiveTeam: {
            method: "DELETE",
            path: "/provisioning/teams/:teamId",
            responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
            summary: "Archive a provisioned team",
        },
        getTeamUsage: {
            method: "GET",
            path: "/provisioning/teams/:teamId/usage",
            responses: {
                200: provisionedTeamUsageSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary:
                "Get organization-delivery quota usage for a provisioned team",
        },
    },
    { metadata: { tag: "Teams" } },
);

const organizationsContract = c.router(
    {
        list: {
            method: "GET",
            path: "/organizations",
            responses: {
                200: itemsList(organizationSchema),
                403: errorSchema,
            },
            summary: "List organizations for the current user",
        },
        create: {
            method: "POST",
            path: "/organizations",
            body: createOrganizationBodySchema,
            responses: { 201: organizationSchema, 403: errorSchema },
            summary: "Create an organization",
        },
        get: {
            method: "GET",
            path: "/organizations/:organizationId",
            responses: {
                200: organizationSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get an organization",
        },
        update: {
            method: "PATCH",
            path: "/organizations/:organizationId",
            body: updateOrganizationBodySchema,
            responses: {
                200: organizationSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Update an organization",
        },
        close: {
            method: "DELETE",
            path: "/organizations/:organizationId",
            responses: {
                204: c.noBody(),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Close an organization",
        },
        listMembers: {
            method: "GET",
            path: "/organizations/:organizationId/members",
            responses: {
                200: itemsList(organizationMemberSchema),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "List organization members",
        },
        addMember: {
            method: "POST",
            path: "/organizations/:organizationId/members",
            body: addOrganizationMemberBodySchema,
            responses: {
                201: organizationMemberSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Add an existing user to an organization",
        },
        updateMember: {
            method: "PATCH",
            path: "/organizations/:organizationId/members/:userId",
            body: updateOrganizationMemberBodySchema,
            responses: {
                200: organizationMemberSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Change an organization member role",
        },
        removeMember: {
            method: "DELETE",
            path: "/organizations/:organizationId/members/:userId",
            responses: {
                204: c.noBody(),
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Remove an organization member",
        },
        listTeams: {
            method: "GET",
            path: "/organizations/:organizationId/teams",
            responses: {
                200: itemsList(teamSchema),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "List teams in an organization",
        },
        createTeam: {
            method: "POST",
            path: "/organizations/:organizationId/teams",
            body: createTeamBodySchema,
            responses: {
                201: teamSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Create a human-managed team in an organization",
        },
        getTeam: {
            method: "GET",
            path: "/organizations/:organizationId/teams/:teamId",
            responses: { 200: teamSchema, 403: errorSchema, 404: errorSchema },
            summary: "Get organization team metadata",
        },
        updateTeam: {
            method: "PATCH",
            path: "/organizations/:organizationId/teams/:teamId",
            body: renameTeamBodySchema,
            responses: { 200: teamSchema, 403: errorSchema, 404: errorSchema },
            summary: "Rename an organization team",
        },
        archiveTeam: {
            method: "DELETE",
            path: "/organizations/:organizationId/teams/:teamId",
            responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
            summary: "Archive an organization team",
        },
        listKeys: {
            method: "GET",
            path: "/organizations/:organizationId/keys",
            responses: {
                200: itemsList(organizationApiKeySchema),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "List organization API keys",
        },
        createKey: {
            method: "POST",
            path: "/organizations/:organizationId/keys",
            body: createOrganizationApiKeyBodySchema,
            responses: {
                201: createdOrganizationApiKeySchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Create an organization API key",
        },
        revokeKey: {
            method: "DELETE",
            path: "/organizations/:organizationId/keys/:keyId",
            responses: {
                204: c.noBody(),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Revoke an organization API key",
        },
        listEsps: {
            method: "GET",
            path: "/organizations/:organizationId/esps",
            responses: {
                200: itemsList(espConfigSchema),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "List organization-owned ESP configurations",
        },
        createEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps",
            body: createEspConfigBodySchema,
            responses: {
                201: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Create an organization-owned ESP configuration",
        },
        getEsp: {
            method: "GET",
            path: "/organizations/:organizationId/esps/:espId",
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get an organization-owned ESP configuration",
        },
        updateEsp: {
            method: "PATCH",
            path: "/organizations/:organizationId/esps/:espId",
            body: updateEspConfigBodySchema,
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Update an organization-owned ESP configuration",
        },
        testEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/test",
            body: testEspConfigBodySchema,
            responses: {
                200: testEspConfigResponseSchema,
                400: errorSchema,
                403: errorSchema,
                404: errorSchema,
                422: errorSchema,
                502: testEspConfigResponseSchema,
            },
            summary: "Test an organization-owned ESP configuration",
        },
        activateEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/activate",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
                422: errorSchema,
            },
            summary: "Activate a verified organization ESP",
        },
        suspendEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/suspend",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Suspend an organization ESP",
        },
        resumeEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/resume",
            body: c.noBody(),
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Resume an organization ESP",
        },
        retireEsp: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/retire",
            body: retireEspConfigBodySchema,
            responses: {
                200: espConfigSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Drain or cancel an organization ESP",
        },
        deleteEsp: {
            method: "DELETE",
            path: "/organizations/:organizationId/esps/:espId",
            responses: {
                204: c.noBody(),
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Delete an eligible never-activated organization ESP",
        },
        getEspFeedback: {
            method: "GET",
            path: "/organizations/:organizationId/esps/:espId/feedback",
            responses: {
                200: feedbackConnectionSchema.nullable(),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get organization ESP feedback configuration",
        },
        upsertEspFeedback: {
            method: "PUT",
            path: "/organizations/:organizationId/esps/:espId/feedback",
            body: upsertFeedbackConnectionBodySchema,
            responses: {
                200: feedbackConnectionSchema,
                400: errorSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Configure organization ESP feedback",
        },
        rotateEspFeedback: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/feedback/rotate",
            body: upsertFeedbackConnectionBodySchema,
            responses: {
                200: feedbackConnectionSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Rotate organization ESP feedback credentials",
        },
        testEspFeedback: {
            method: "POST",
            path: "/organizations/:organizationId/esps/:espId/feedback/test",
            body: c.noBody(),
            responses: {
                200: testFeedbackConnectionResponseSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Verify organization ESP feedback configuration",
        },
        removeEspFeedback: {
            method: "DELETE",
            path: "/organizations/:organizationId/esps/:espId/feedback",
            responses: {
                204: c.noBody(),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Disable organization ESP feedback configuration",
        },
        getDeliveryPolicy: {
            method: "GET",
            path: "/organizations/:organizationId/delivery-policy",
            responses: {
                200: organizationDeliveryPolicySchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get organization delivery policy",
        },
        updateDeliveryPolicy: {
            method: "PUT",
            path: "/organizations/:organizationId/delivery-policy",
            body: updateOrganizationDeliveryPolicyBodySchema,
            responses: {
                200: organizationDeliveryPolicySchema,
                403: errorSchema,
                404: errorSchema,
                422: errorSchema,
            },
            summary: "Update organization delivery policy",
        },
        getUsage: {
            method: "GET",
            path: "/organizations/:organizationId/usage",
            responses: {
                200: organizationUsageSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get aggregate organization delivery quota usage",
        },
        getMailActivity: {
            method: "GET",
            path: "/organizations/:organizationId/mail-activity",
            query: organizationMailActivityQuerySchema,
            responses: {
                200: organizationMailActivitySchema,
                400: errorSchema,
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get organization transactional mail activity",
            description:
                "Returns per-team and organization-total transactional mail counts (`sent`, `queued`, `failed`, `bounced`) for a window of 1, 3, 7, or 30 days (default 7). Includes teams with zero activity. Does not include campaigns, broadcasts, sequences, recipients, subjects, or email bodies. Shared-delivery quota remains on `/usage`.",
        },
        enterTeam: {
            method: "POST",
            path: "/organizations/:organizationId/teams/:teamId/enter",
            body: organizationEnterTeamBodySchema,
            responses: {
                200: organizationEnterTeamResponseSchema,
                403: errorSchema,
                404: errorSchema,
                422: errorSchema,
            },
            summary: "Enter an organization team as a human admin",
            description:
                "Grants the calling human organization owner or administrator a permanent team `admin` membership, recorded as organization audit action `team.entered`. Organization API keys cannot enter. Archived teams cannot be entered. Idempotent if membership already exists.",
        },
        listAuditEvents: {
            method: "GET",
            path: "/organizations/:organizationId/audit-events",
            responses: {
                200: itemsList(organizationAuditEventSchema),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "List recent organization audit events",
        },
        getEspGrant: {
            method: "GET",
            path: "/organizations/:organizationId/teams/:teamId/esp-grant",
            responses: {
                200: espGrantSchema.nullable(),
                403: errorSchema,
                404: errorSchema,
            },
            summary: "Get a team's organization ESP grant",
        },
        upsertEspGrant: {
            method: "PUT",
            path: "/organizations/:organizationId/teams/:teamId/esp-grant",
            body: upsertEspGrantBodySchema,
            responses: {
                200: espGrantSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
                422: errorSchema,
            },
            summary: "Create or update a team's organization ESP grant",
        },
        transitionEspGrant: {
            method: "POST",
            path: "/organizations/:organizationId/teams/:teamId/esp-grant/transition",
            body: transitionEspGrantBodySchema,
            responses: {
                200: espGrantSchema,
                403: errorSchema,
                404: errorSchema,
                409: errorSchema,
            },
            summary: "Transition a team's organization ESP grant",
        },
    },
    { metadata: { tag: "Organizations" } },
);

const deliveryContract = c.router(
    {
        sendingOptions: {
            method: "GET",
            path: "/sending-options",
            responses: { 200: itemsList(sendingOptionSchema) },
            summary: "List sanitized sending options for the active team",
        },
        getSettings: {
            method: "GET",
            path: "/settings/delivery",
            responses: { 200: teamDeliverySettingsSchema },
            summary: "Get team delivery settings",
        },
        updateSettings: {
            method: "PATCH",
            path: "/settings/delivery",
            body: updateTeamDeliverySettingsBodySchema,
            responses: {
                200: teamDeliverySettingsSchema,
                403: errorSchema,
                409: errorSchema,
                422: errorSchema,
            },
            summary: "Choose the team's default delivery source",
        },
    },
    { metadata: { tag: "Delivery" } },
);

const overviewContract = c.router(
    {
        get: {
            method: "GET",
            path: "/overview",
            query: overviewQuerySchema,
            responses: { 200: overviewSchema },
            summary: "Get team overview metrics for a delivery activity window",
            description:
                "Use `rangeDays` (1, 3, 7, or 30; default 7) to filter transactional delivery activity and scheduled broadcasts.",
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
    organizations: organizationsContract,
    delivery: deliveryContract,
    provisioning: provisioningContract,
    overview: overviewContract,
    feedback: feedbackContract,
    deliveryEvents: deliveryEventsContract,
    suppressions: suppressionsContract,
});

export type Contract = typeof contract;
