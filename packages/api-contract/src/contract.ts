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
  espConfigSchema,
  testEspConfigBodySchema,
  testEspConfigResponseSchema,
  upsertEspConfigBodySchema,
} from "./schemas/esp";
import {
  apiKeySchema,
  createApiKeyBodySchema,
  createTeamBodySchema,
  provisionTeamBodySchema,
  provisionTeamResponseSchema,
  renameTeamBodySchema,
  teamSchema,
} from "./schemas/teams";

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
      responses: { 200: paginated(contactSchema) },
      summary: "List contacts",
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
      responses: { 200: sequenceSchema, 404: errorSchema },
      summary: "Update a broadcast or sequence",
    },
    addEmail: {
      method: "POST",
      path: "/sequences/:sequenceId/emails",
      body: addSequenceEmailBodySchema,
      responses: { 201: sequenceSchema, 400: errorSchema, 404: errorSchema },
      summary: "Add an email to a sequence",
    },
    updateEmail: {
      method: "PATCH",
      path: "/sequences/:sequenceId/emails/:emailId",
      body: updateSequenceEmailBodySchema,
      responses: { 200: sequenceSchema, 400: errorSchema, 404: errorSchema },
      summary: "Update an email within a sequence",
    },
    removeEmail: {
      method: "DELETE",
      path: "/sequences/:sequenceId/emails/:emailId",
      responses: { 200: sequenceSchema, 400: errorSchema, 404: errorSchema },
      summary: "Remove an email from a sequence",
    },
    start: {
      method: "POST",
      path: "/sequences/:sequenceId/start",
      body: c.noBody(),
      responses: { 200: sequenceSchema, 400: errorSchema },
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
      summary: "Delivery / open-rate / click-through-rate stats for a sequence",
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
 * ESP configuration is a per-team *setting* (a singleton, get/upsert/remove/
 * test — never a list, never multiple per team), not a resource collection
 * like contacts/templates/sequences, so it's nested under `settings` rather
 * than sitting as a sibling top-level group. This is also where future
 * per-team settings (e.g. default sending identity, branding) should live.
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
      responses: { 204: c.noBody() },
      summary:
        "Remove the team's ESP configuration (falls back to the platform default sender)",
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

const settingsContract = c.router({
  esp: espSettingsContract,
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
      responses: { 201: apiKeySchema, 404: errorSchema },
      summary: "Create a new API key for a team",
    },
    removeKey: {
      method: "DELETE",
      path: "/teams/:teamId/keys/:key",
      responses: { 204: c.noBody(), 404: errorSchema },
      summary: "Revoke an API key",
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

export const contract = c.router({
  contacts: contactsContract,
  templates: templatesContract,
  sequences: sequencesContract,
  settings: settingsContract,
  teams: teamsContract,
  provisioning: provisioningContract,
});

export type Contract = typeof contract;
