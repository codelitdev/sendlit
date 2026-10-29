import { initContract } from "@ts-rest/core";
import { z } from "zod";
import {
  billingActionTokenBodySchema,
  billingActionTokenResponseSchema,
  billingCancellationResponseSchema,
  billingCatalogSchema,
  billingCheckoutBodySchema,
  billingCheckoutResponseSchema,
  billingPlanChangeBodySchema,
  billingPlanChangeResponseSchema,
  billingPortalResponseSchema,
  createSendingDomainBodySchema,
  organizationBillingSchema,
  organizationCheckoutBodySchema,
  organizationCheckoutResponseSchema,
  organizationPlanUsageSchema,
  sendingDomainSchema,
} from "./schemas/billing";
import { errorSchema, itemsList, paginated } from "./schemas/common";
import {
  contactDeletionSchema,
  type contactDeliverySchema,
  contactSchema,
  contactSelectionSchema,
  createContactBodySchema,
  deleteContactsBodySchema,
  exportContactsQuerySchema,
  importContactsBodySchema,
  importContactsResultSchema,
  listContactsQuerySchema,
  previewContactDeletionResultSchema,
  updateContactBodySchema,
} from "./schemas/contacts";
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
import {
  deliveryEventSchema,
  listDeliveryEventsQuerySchema,
} from "./schemas/delivery-events";
import {
  createEspConfigBodySchema,
  domainAuthenticationQuerySchema,
  domainAuthenticationSchema,
  espConfigSchema,
  retireEspConfigBodySchema,
  testEspConfigBodySchema,
  testEspConfigResponseSchema,
  updateEspConfigBodySchema,
} from "./schemas/esp";
import {
  contactEventSchema,
  createEventDefinitionBodySchema,
  eventDefinitionDetailSchema,
  eventDefinitionSchema,
  listContactEventsQuerySchema,
  trackEventBodySchema,
  trackEventResponseSchema,
  updateEventDefinitionBodySchema,
} from "./schemas/events";
import {
  feedbackConnectionSchema,
  testFeedbackConnectionResponseSchema,
  upsertFeedbackConnectionBodySchema,
} from "./schemas/feedback";
import {
  createSignupFormBodySchema,
  signupFormSchema,
  signupFormSenderErrorSchema,
  updateSignupFormBodySchema,
} from "./schemas/forms";
import {
  listMediaQuerySchema,
  mediaReferenceSchema,
  mediaSchema,
  mediaUploadSignatureSchema,
  updateMediaBodySchema,
} from "./schemas/media";
import {
  addOrganizationMemberBodySchema,
  createdOrganizationApiKeySchema,
  createOrganizationApiKeyBodySchema,
  createOrganizationBodySchema,
  organizationApiKeySchema,
  organizationAuditEventSchema,
  organizationEnterTeamBodySchema,
  organizationEnterTeamResponseSchema,
  organizationListItemSchema,
  organizationMailActivityQuerySchema,
  organizationMailActivitySchema,
  organizationMemberSchema,
  organizationSchema,
  organizationUsageSchema,
  updateOrganizationBodySchema,
  updateOrganizationMemberBodySchema,
} from "./schemas/organizations";
import { overviewQuerySchema, overviewSchema } from "./schemas/overview";
import { connectSndsBodySchema, reputationSchema } from "./schemas/reputation";
import {
  createSegmentBodySchema,
  segmentSchema,
  updateSegmentBodySchema,
} from "./schemas/segments";
import {
  addSequenceEmailBodySchema,
  createSequenceBodySchema,
  listSequencesQuerySchema,
  listSubscribersQuerySchema,
  sendSequenceEmailTestBodySchema,
  sequenceEmailTestResultSchema,
  sequenceSchema,
  sequenceStatsSchema,
  updateSequenceBodySchema,
  updateSequenceEmailBodySchema,
} from "./schemas/sequences";
import {
  generalSettingsSchema,
  trackingDomainSchema,
  updateGeneralSettingsBodySchema,
  updateTrackingDomainBodySchema,
} from "./schemas/settings";
import {
  createSuppressionBodySchema,
  listSuppressionsQuerySchema,
  releaseSuppressionBodySchema,
  suppressionSchema,
} from "./schemas/suppressions";
import {
  deleteTagResultSchema,
  renameTagBodySchema,
  renameTagResultSchema,
  tagReferencesSchema,
  tagSummarySchema,
} from "./schemas/tags";
import {
  apiKeySchema,
  createApiKeyBodySchema,
  createdApiKeySchema,
  createTeamBodySchema,
  provisionedTeamSchema,
  provisionedTeamUsageSchema,
  provisionTeamBodySchema,
  provisionTeamResponseSchema,
  renameTeamBodySchema,
  teamSchema,
  updateProvisionedTeamBodySchema,
} from "./schemas/teams";
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
  listTransactionalEmailsQuerySchema,
  missingTemplateVariablesErrorSchema,
  sendEmailBodySchema,
  sendEmailResponseSchema,
  transactionalEmailDetailSchema,
  transactionalEmailSchema,
} from "./schemas/transactional";
import {
  listWebIssuesQuerySchema,
  updateWebPublishingBodySchema,
  updateWebSettingsBodySchema,
  webIssueSchema,
  webIssueSummarySchema,
  webPublishingSchema,
  webSettingsSchema,
} from "./schemas/web";

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
      responses: {
        201: contactSchema,
        402: errorSchema,
        409: errorSchema,
      },
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
    import: {
      method: "POST",
      path: "/contacts/import",
      body: importContactsBodySchema,
      responses: {
        200: importContactsResultSchema,
        400: errorSchema,
      },
      summary: "Import contacts",
      description:
        "Creates or updates up to 1000 contacts per request, matched by email. A status can only get stricter (subscribed < unsubscribed < bounced < complained): an import never re-subscribes an unsubscribed or suppressed contact, and bounced or complained rows are imported unsubscribed and added to the suppression list. Paused contacts stay subscribed with the `paused` tag. Tags and custom fields are merged into existing contacts, and an earlier createdAt replaces a later one. Imports don't trigger sequences. Subscribed contacts over the plan's limit are skipped with `plan_limit_reached`.",
    },
    export: {
      method: "GET",
      path: "/contacts/export",
      query: exportContactsQuerySchema,
      responses: {
        200: c.otherResponse({ contentType: "text/csv", body: z.string() }),
        400: errorSchema,
        404: errorSchema,
      },
      summary: "Export contacts as CSV",
      description:
        "Returns every contact, or those matching segmentId and/or filter, as CSV: email, name, status (subscribed, unsubscribed, bounced or complained), tags, created_at, suppression_reason, then one column per custom field.",
    },
    previewBulkDelete: {
      method: "POST",
      path: "/contacts/bulk-delete/preview",
      body: contactSelectionSchema,
      responses: {
        200: previewContactDeletionResultSchema,
        400: errorSchema,
        404: errorSchema,
      },
      summary: "Preview a bulk contact deletion",
      description:
        "Counts the contacts a bulk delete would remove (and how many are unsubscribed) without deleting anything. Pass the count to bulkDelete as expectedCount. 404 when segmentId doesn't exist.",
    },
    bulkDelete: {
      method: "POST",
      path: "/contacts/bulk-delete",
      body: deleteContactsBodySchema,
      responses: {
        200: contactDeletionSchema,
        202: contactDeletionSchema,
        400: errorSchema,
        404: errorSchema,
        409: errorSchema.extend({ count: z.number().int().optional() }),
      },
      summary: "Delete contacts in bulk",
      description:
        "Permanently deletes up to 1000 contacts by id, or every contact matching q, segmentId and filter. With match, pass the preview's count as expectedCount; if the live count differs nothing is deleted (409 count_changed, with the new count). Only contacts that existed when the request arrived are deleted. Up to 1000 contacts are deleted before the response (200, status completed); larger selections run in the background (202, status queued) and report progress at GET /contacts/bulk-delete/{deletionId}. Each contact's custom field values, sequence progress, events and delivery records are deleted with it, and no sequence triggers fire. Suppressions are kept, and the address of every deleted unsubscribed contact is added to the suppression list (reason manual), so re-importing or re-adding it never mails it again. This is not a full privacy erasure: delivery logs and the suppression list keep the address.",
    },
    bulkDeleteStatus: {
      method: "GET",
      path: "/contacts/bulk-delete/:deletionId",
      responses: { 200: contactDeletionSchema, 404: errorSchema },
      summary: "Get a bulk contact deletion",
      description:
        "Progress of a background bulk delete. Finished deletions are kept for 24 hours.",
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
      responses: {
        200: contactSchema,
        402: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
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
    events: {
      method: "GET",
      path: "/contacts/:contactId/events",
      query: listContactEventsQuerySchema,
      responses: { 200: paginated(contactEventSchema), 404: errorSchema },
      summary: "List the custom events received for a contact",
      description:
        "Newest first by occurredAt. `enrolledSequences` lists the sequences each event started.",
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
 * Team-wide tag management. Tags live on contacts, so a tag "exists" while at
 * least one contact carries it; segments, broadcast/sequence filters and
 * triggers, sequence email actions and signup forms only name it.
 */
const tagsContract = c.router(
  {
    list: {
      method: "GET",
      path: "/tags",
      responses: { 200: itemsList(tagSummarySchema) },
      summary: "List tags",
      description:
        "Returns every tag carried by at least one of the team's contacts, sorted by name, with the number of contacts that carry it.",
    },
    references: {
      method: "GET",
      path: "/tags/:tag/references",
      responses: { 200: tagReferencesSchema },
      summary: "List where a tag is used",
      description:
        "Returns how many contacts carry the tag and the segments, broadcasts, sequences (audience filters, tag triggers, email tag actions) and signup forms that name it. Call it before deleting a tag.",
    },
    rename: {
      method: "PATCH",
      path: "/tags/:tag",
      body: renameTagBodySchema,
      responses: {
        200: renameTagResultSchema,
        400: errorSchema,
        404: errorSchema,
      },
      summary: "Rename a tag",
      description:
        "Renames the tag on every contact, and in segments, broadcast and sequence filters and tag triggers, sequence email tag actions and signup forms. Renaming to a tag that already exists merges the two. Sent broadcasts keep their original filters. Renaming doesn't trigger tag-added or tag-removed sequences. 404 `tag_not_found` when nothing uses the tag; 400 `tag_unchanged` when the new name is the same.",
    },
    remove: {
      method: "DELETE",
      path: "/tags/:tag",
      body: c.noBody(),
      responses: { 200: deleteTagResultSchema, 404: errorSchema },
      summary: "Delete a tag from every contact",
      description:
        "Removes the tag from every contact of the team. Segments, filters, triggers, email actions and signup forms that name the tag are left as they are and returned in `references`: a filter on a deleted tag matches nobody, and a trigger or form can add it again. Check `GET /tags/:tag/references` first. Deleting doesn't trigger tag-removed sequences. 404 `tag_not_found` when nothing uses the tag.",
    },
  },
  { metadata: { tag: "Tags" } },
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
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder in user-facing API docs, not a template
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
      description:
        "Permanently deletes the template. Its images that no other template or email uses are deleted from the media library and storage, unless a transactional email was sent with the template.",
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
      description:
        "A broadcast's title is its email's subject, so once the broadcast has been sent, changing the title returns 400 with the error \"This broadcast has already been sent\". `viewInBrowser` can be changed at any time; turning it off also takes down the web versions linked from emails already sent.",
    },
    remove: {
      method: "DELETE",
      path: "/sequences/:sequenceId",
      responses: { 204: c.noBody(), 404: errorSchema },
      summary: "Delete a broadcast or sequence",
      description:
        "Permanently deletes the broadcast or sequence. Images it uses that nothing else uses are deleted from the media library and storage; images used by sent mail are kept.",
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
        "When templateId is supplied, it must identify a marketing template; transactional templates return 422 template_not_marketing. Edits to an active sequence's email apply to later sends only: the \"view in browser\" page of an email already sent keeps showing what was sent. A sent broadcast can't be edited; the request returns it unchanged.",
    },
    sendEmailTest: {
      method: "POST",
      path: "/sequences/:sequenceId/emails/:emailId/test",
      body: sendSequenceEmailTestBodySchema,
      responses: {
        200: sequenceEmailTestResultSchema,
        400: errorSchema,
        404: errorSchema,
        429: errorSchema,
      },
      summary: "Send a test of a broadcast or sequence email",
      description:
        "Renders the email exactly like a real send (merge tags, footer, tracking) and sends it with a `[Test]` subject prefix through the delivery source the real send would use. Its \"view in browser\" link shows the email as it was when tested, not later edits. Merge tags use the recipient's contact data when they are a contact. Opens, clicks and the unsubscribe link in a test change nothing. Suppressed addresses are skipped. Every recipient counts as one test: by default a team can send 100 test emails in any 24 hours (50 in any 3 hours) and 20 per email per 24 hours, after which this returns 429 `test_send_limit_reached` or `test_send_email_limit_reached`. Tests through an organization's shared mailbox also count against the team's shared-delivery quota (429 `organization_team_quota_exhausted` or `organization_quota_exhausted`).",
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
      description:
        "Removes the email. Images it uses that nothing else uses are deleted from the media library and storage; images used by sent mail are kept.",
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
        "Requires a non-empty mailing address in the team's general settings. On SendLit Cloud, a new organization's first broadcast to 1,000 or more contacts through its own ESP is reviewed once before it can start (400 `broadcast_held_for_review`); start it again once approved.",
    },
    pause: {
      method: "POST",
      path: "/sequences/:sequenceId/pause",
      body: c.noBody(),
      responses: { 200: sequenceSchema, 400: errorSchema },
      summary: "Pause an active sequence",
    },
    getWeb: {
      method: "GET",
      path: "/sequences/:sequenceId/web",
      responses: { 200: webPublishingSchema, 404: errorSchema },
      summary: "Get a broadcast's web publishing settings",
    },
    updateWeb: {
      method: "PATCH",
      path: "/sequences/:sequenceId/web",
      body: updateWebPublishingBodySchema,
      responses: {
        200: webPublishingSchema,
        400: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: "Publish a broadcast to the web, or change how it's published",
      description:
        "Only broadcasts can be published. The page goes live once the broadcast is sent. Publishing without a slug makes one from the title; 409 `slug_taken` when another issue of the team uses the slug.",
    },
    stats: {
      method: "GET",
      path: "/sequences/:sequenceId/stats",
      responses: { 200: sequenceStatsSchema, 404: errorSchema },
      summary: "Delivery / open-rate / click-through-rate stats for a sequence",
    },
    subscribers: {
      method: "GET",
      path: "/sequences/:sequenceId/subscribers",
      query: listSubscribersQuerySchema,
      responses: { 200: c.type<string[]>(), 404: errorSchema },
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
        402: errorSchema,
        422: z.union([
          missingTemplateVariablesErrorSchema,
          templateNotTransactionalErrorSchema,
          errorSchema,
        ]),
        409: errorSchema,
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

/**
 * Custom events — see `apps/api/docs/custom_events.md`. `track` records a
 * named event for one contact and starts every active sequence whose
 * `event:custom` trigger matches. Definitions are the team's list of events,
 * registered on first receipt or by hand.
 */
const eventsContract = c.router(
  {
    track: {
      method: "POST",
      path: "/events",
      body: trackEventBodySchema,
      responses: {
        202: trackEventResponseSchema,
        400: errorSchema,
        402: errorSchema,
        404: errorSchema,
        409: errorSchema,
        422: errorSchema,
        429: errorSchema,
      },
      summary: "Track a custom event",
      description:
        "Stores the event, then starts every active sequence whose trigger is `event:custom` with this name and whose filters match. An unknown email creates the contact unless `createContact` is false (then 404). An unknown `contactId` is always 404. The same `idempotencyKey` within 30 days returns the original event with `duplicate: true`. Events with `backfill: true`, or an `occurredAt` more than 72 hours old, are stored but never start a sequence.",
    },
    definitions: {
      method: "GET",
      path: "/events/definitions",
      responses: { 200: itemsList(eventDefinitionSchema) },
      summary: "List the team's events",
    },
    definition: {
      method: "GET",
      path: "/events/definitions/:name",
      responses: { 200: eventDefinitionDetailSchema, 404: errorSchema },
      summary: "Get an event, with its last payload",
    },
    createDefinition: {
      method: "POST",
      path: "/events/definitions",
      body: createEventDefinitionBodySchema,
      responses: {
        201: eventDefinitionDetailSchema,
        400: errorSchema,
        409: errorSchema,
        422: errorSchema,
      },
      summary: "Register an event before it is sent",
    },
    updateDefinition: {
      method: "PATCH",
      path: "/events/definitions/:name",
      body: updateEventDefinitionBodySchema,
      responses: {
        200: eventDefinitionDetailSchema,
        400: errorSchema,
        404: errorSchema,
      },
      summary: "Update an event's description or declared properties",
    },
    deleteDefinition: {
      method: "DELETE",
      path: "/events/definitions/:name",
      body: c.noBody(),
      responses: { 204: c.noBody(), 404: errorSchema, 409: errorSchema },
      summary: "Remove an event from the list",
      description:
        "Stored events are kept, and a later event with this name registers it again. Returns 409 event_definition_in_use while a sequence uses it as its trigger.",
    },
  },
  { metadata: { tag: "Events" } },
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
      description:
        "Removes an ESP with no active or queued dependencies. Draft, paused, and completed sequences are detached first.",
    },
    domainAuthentication: {
      method: "GET",
      path: "/settings/esps/:espId/domain-authentication",
      query: domainAuthenticationQuerySchema,
      responses: {
        200: domainAuthenticationSchema,
        404: errorSchema,
        422: errorSchema,
      },
      summary: "Check SPF, DKIM and DMARC for an ESP's sending domain",
      description:
        "Looks up the DNS records of the ESP's From address domain and returns each check's status with the records to add. Returns 422 `from_email_missing` when the ESP has no From address.",
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

const webSettingsContract = c.router(
  {
    get: {
      method: "GET",
      path: "/settings/web",
      responses: { 200: webSettingsSchema },
      summary: "Get the team's web archive settings",
    },
    update: {
      method: "PATCH",
      path: "/settings/web",
      body: updateWebSettingsBodySchema,
      responses: { 200: webSettingsSchema, 400: errorSchema, 409: errorSchema },
      summary: "Update the team's web archive settings",
      description:
        "Turning hosted pages on picks a handle from the team name and creates a signup form for the archive when none is set. 409 `handle_taken` when another team uses the handle.",
    },
  },
  { metadata: { tag: "Web publishing" } },
);

/** Custom tracking domain (#50): a per-team singleton like the general
 * settings. */
const trackingDomainContract = c.router(
  {
    get: {
      method: "GET",
      path: "/settings/tracking-domain",
      responses: { 200: trackingDomainSchema },
      summary: "Get the team's custom tracking domain",
      description:
        'Open, click, unsubscribe and "view in browser" links use the domain once it is verified; until then, and after it stops working, they use SendLit\'s own host.',
    },
    update: {
      method: "PUT",
      path: "/settings/tracking-domain",
      body: updateTrackingDomainBodySchema,
      responses: { 200: trackingDomainSchema, 400: errorSchema, 409: errorSchema },
      summary: "Set or remove the team's custom tracking domain",
      description:
        "Use a subdomain (for example `track.example.com`) with a CNAME record pointing to `cnameTarget`. A new domain is `pending` until it is verified; SendLit rechecks pending domains every hour. `null` removes it. Links in emails already sent on a previous domain keep working. 400 `tracking_domain_invalid`, 409 `tracking_domain_taken`.",
    },
    verify: {
      method: "POST",
      path: "/settings/tracking-domain/verify",
      body: c.noBody(),
      responses: { 200: trackingDomainSchema, 400: errorSchema },
      summary: "Check the team's custom tracking domain now",
      description:
        "Checks the CNAME record and that SendLit answers over HTTPS on the domain. 400 `tracking_domain_not_set`.",
    },
  },
  { metadata: { tag: "Settings" } },
);

const settingsContract = c.router({
  esps: espCollectionContract,
  general: generalSettingsContract,
  trackingDomain: trackingDomainContract,
  web: webSettingsContract,
});

const reputationContract = c.router(
  {
    get: {
      method: "GET",
      path: "/reputation",
      responses: { 200: reputationSchema },
      summary: "Get mailbox provider reputation data for the last 30 days",
      description:
        "Google Postmaster Tools (spam rate, SPF/DKIM/DMARC pass rates, delivery errors and compliance per sending domain) and Microsoft SNDS (filter result, complaint rate and trap hits per IP), with current alerts.",
    },
    connectGoogle: {
      method: "POST",
      path: "/reputation/google/connect",
      body: c.noBody(),
      responses: {
        200: z.object({ authorizationUrl: z.string() }),
        403: errorSchema,
        409: errorSchema,
      },
      summary: "Start connecting Google Postmaster Tools",
      description:
        "Returns the Google sign-in URL to open in a browser. After consent, Google redirects back to SendLit and the data syncs daily. 409 `google_postmaster_not_configured` when this deployment has no Google OAuth client.",
    },
    disconnectGoogle: {
      method: "DELETE",
      path: "/reputation/google",
      responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
      summary: "Disconnect Google Postmaster Tools and delete its data",
    },
    connectSnds: {
      method: "PUT",
      path: "/reputation/snds",
      body: connectSndsBodySchema,
      responses: { 200: reputationSchema, 403: errorSchema, 422: errorSchema },
      summary: "Connect Microsoft SNDS with its automated data access link",
      description:
        "The link is checked by downloading the data once. 422 `snds_link_invalid` for links that aren't SNDS links or don't return SNDS data.",
    },
    disconnectSnds: {
      method: "DELETE",
      path: "/reputation/snds",
      responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
      summary: "Disconnect Microsoft SNDS and delete its data",
    },
    sync: {
      method: "POST",
      path: "/reputation/sync",
      body: c.noBody(),
      responses: { 200: reputationSchema, 429: errorSchema },
      summary: "Refresh reputation data now",
      description:
        "Data also refreshes daily on its own. Limited to once every 5 minutes.",
    },
  },
  { metadata: { tag: "Reputation" } },
);

const webIssuesContract = c.router(
  {
    list: {
      method: "GET",
      path: "/web/issues",
      query: listWebIssuesQuerySchema,
      responses: { 200: paginated(webIssueSummarySchema) },
      summary: "List the team's published issues",
      description:
        "Broadcasts published to the web that have been sent, newest first. Works whether or not SendLit hosts the pages, so a platform can render the archive itself.",
    },
    get: {
      method: "GET",
      path: "/web/issues/:slug",
      responses: { 200: webIssueSchema, 404: errorSchema },
      summary: "Get a published issue with its HTML",
      description:
        "The HTML has no personal data, tracking or unsubscribe links. Merge tags fall back to their defaults.",
    },
  },
  { metadata: { tag: "Web publishing" } },
);

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
        402: errorSchema,
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
    getOrganization: {
      method: "GET",
      path: "/provisioning/organization",
      responses: {
        200: organizationSchema,
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: "Get the organization bound to the calling API key",
      description:
        "Returns only the organization associated with the authenticated organization API key. Requires the organization:read scope; the organization cannot be selected in the request.",
    },
    provisionTeam: {
      method: "POST",
      path: "/provisioning/teams",
      body: provisionTeamBodySchema,
      responses: {
        200: provisionTeamResponseSchema,
        400: errorSchema,
        401: errorSchema,
        402: errorSchema,
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
      summary: "Get a provisioned team within the authenticated organization",
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
      summary: "Get organization-delivery quota usage for a provisioned team",
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
        200: z.object({
          items: z.array(organizationListItemSchema),
          ownsFreeOrganization: z.boolean(),
        }),
        403: errorSchema,
      },
      summary: "List organizations for the current user",
    },
    create: {
      method: "POST",
      path: "/organizations",
      body: createOrganizationBodySchema,
      responses: {
        201: organizationSchema,
        403: errorSchema,
        409: errorSchema,
      },
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
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Delete an organization",
      description:
        "Owner only, from a dashboard session. Fails with `409 active_subscription_exists` while a subscription is active or paid through a future date (cancel it in billing first), and with `409 billing_checkout_pending` while a checkout is open. Deleting closes the organization, archives its teams, revokes organization and team API keys and sending domains, retires every ESP config with its credentials wiped, and deletes its teams' MediaLit files. Billing history, audit events, delivery reporting and suppressions are kept.",
    },
    abandon: {
      method: "POST",
      path: "/organizations/:organizationId/abandon",
      body: c.noBody(),
      responses: {
        204: c.noBody(),
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: "Hide a pending-payment organization after a cancelled checkout",
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
      description:
        "Organization API keys may test an ESP with an explicit `to` address; they have no signed-in user email to use as a fallback. Requires `esps:manage` and organization binding.",
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
        400: errorSchema,
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
      description:
        "Organization API keys require the delivery:read scope and must be bound to the path organization. Owner/admin user sessions remain supported.",
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
      description:
        "Organization API keys require the delivery:manage scope and must be bound to the path organization. This scope authorizes every field in the delivery-policy schema, including shared quotas and team delivery controls. Owner/admin user sessions remain supported.",
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
      summary:
        "Transition a team's organization ESP grant; revoking detaches safe campaigns",
    },
    listSendingDomains: {
      method: "GET",
      path: "/organizations/:organizationId/sending-domains",
      responses: {
        200: itemsList(sendingDomainSchema),
        403: errorSchema,
        404: errorSchema,
      },
      summary: "List verified sending domains",
    },
    createSendingDomain: {
      method: "POST",
      path: "/organizations/:organizationId/sending-domains",
      body: createSendingDomainBodySchema,
      responses: {
        201: sendingDomainSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: "Create a DNS verification challenge for a sending domain",
    },
    verifySendingDomain: {
      method: "POST",
      path: "/organizations/:organizationId/sending-domains/:domainId/verify",
      body: c.noBody(),
      responses: {
        200: sendingDomainSchema,
        403: errorSchema,
        404: errorSchema,
        422: errorSchema,
      },
      summary: "Refresh DNS verification for a sending domain",
    },
    revokeSendingDomain: {
      method: "DELETE",
      path: "/organizations/:organizationId/sending-domains/:domainId",
      responses: { 204: c.noBody(), 403: errorSchema, 404: errorSchema },
      summary: "Revoke a sending domain",
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
      summary: "Create or rotate a user ESP's delivery-feedback connection",
      description:
        "Creates the connection (and its stable webhook URL) on first call; a later call rotates the credential without changing the URL. The provider is always the ESP's current provider, not client-writable. Amazon SES takes `expectedTopicArn` (the SNS topic subscribed to the webhook URL) instead of `credential`; SendLit confirms the SNS subscription automatically. Fails with 400 `feedback_credential_required`, `feedback_topic_arn_required`, or `feedback_topic_arn_invalid` when the body doesn't fit the provider.",
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
      description:
        "A smoke test that does not call the provider. Fails with `feedback_invalid_credentials` when the stored credential can't be read, or for Amazon SES with `feedback_subscription_unconfirmed` until SNS has confirmed the subscription.",
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
const formsContract = c.router(
  {
    list: {
      method: "GET",
      path: "/forms",
      responses: { 200: z.object({ items: z.array(signupFormSchema) }) },
      summary: "List signup forms",
    },
    create: {
      method: "POST",
      path: "/forms",
      body: createSignupFormBodySchema,
      responses: {
        201: signupFormSchema,
        400: errorSchema,
        422: signupFormSenderErrorSchema,
      },
      summary: "Create a signup form",
      description:
        "A public signup form for the team. People subscribe on its hosted page (`url`) or through an HTML form on your site that posts `email` (and optionally `name`) to the same URL, as a form post or JSON. Double opt-in (the default) emails a confirmation link through the team's delivery source and subscribes only once it is clicked, so it needs a sending mailbox: without one, creating a double opt-in form (or switching a form to it) fails with 422 `confirmation_sender_unavailable`, and an existing form's `sendingIssue` says why submissions are failing; single opt-in never resubscribes someone who unsubscribed. Submissions are rate limited per IP and per form, and suppressed or disposable addresses are dropped. A new subscriber triggers `subscriber:added` sequences.",
    },
    get: {
      method: "GET",
      path: "/forms/:formId",
      responses: { 200: signupFormSchema, 404: errorSchema },
      summary: "Get a signup form",
    },
    update: {
      method: "PATCH",
      path: "/forms/:formId",
      body: updateSignupFormBodySchema,
      responses: {
        200: signupFormSchema,
        404: errorSchema,
        422: signupFormSenderErrorSchema,
      },
      summary: "Update a signup form",
      description:
        "Turning double opt-in on fails with 422 `confirmation_sender_unavailable` when the team can't send the confirmation email.",
    },
    remove: {
      method: "DELETE",
      path: "/forms/:formId",
      responses: { 204: c.noBody(), 404: errorSchema },
      summary: "Delete a signup form",
    },
  },
  { metadata: { tag: "Contacts" } },
);

const suppressionsContract = c.router(
  {
    list: {
      method: "GET",
      path: "/suppressions",
      query: listSuppressionsQuerySchema,
      responses: { 200: paginated(suppressionSchema) },
      summary: "List the team's suppressed recipients",
    },
    create: {
      method: "POST",
      path: "/suppressions",
      body: createSuppressionBodySchema,
      responses: { 201: suppressionSchema, 400: errorSchema },
      summary: "Suppress an address",
      description:
        "Adds a manual suppression: SendLit never mails the address again from this team (broadcasts, sequences or transactional) until the suppression is released. Use it for role accounts, legal requests or known spam traps. An existing stronger suppression (for example a complaint) is kept.",
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

const billingContract = c.router(
  {
    actionToken: {
      method: "POST",
      path: "/billing/action-token",
      body: billingActionTokenBodySchema,
      responses: {
        201: billingActionTokenResponseSchema,
        401: errorSchema,
        403: errorSchema,
        503: errorSchema,
      },
      summary: "Issue a single-use token for a sensitive billing action",
    },
    organizationCheckout: {
      method: "POST",
      path: "/billing/organization-checkouts",
      body: organizationCheckoutBodySchema,
      responses: {
        201: organizationCheckoutResponseSchema,
        400: errorSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Create a paid organization and hosted checkout",
    },
    catalog: {
      method: "GET",
      path: "/billing/catalog",
      responses: { 200: billingCatalogSchema, 503: errorSchema },
      summary: "Read the active billing catalog",
      description:
        "Returns environment-configured offers without provider product IDs. Amounts are integer minor units.",
    },
    organizationBilling: {
      method: "GET",
      path: "/organizations/:organizationId/billing",
      responses: {
        200: organizationBillingSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: "Read organization plan and billing status",
    },
    organizationPlanUsage: {
      method: "GET",
      path: "/organizations/:organizationId/plan-usage",
      responses: {
        200: organizationPlanUsageSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: "Read organization plan usage",
    },
    checkout: {
      method: "POST",
      path: "/organizations/:organizationId/billing/checkout",
      body: billingCheckoutBodySchema,
      responses: {
        201: billingCheckoutResponseSchema,
        400: errorSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Create a hosted organization checkout",
    },
    portal: {
      method: "POST",
      path: "/organizations/:organizationId/billing/portal",
      body: c.noBody(),
      responses: {
        201: billingPortalResponseSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        404: errorSchema,
        503: errorSchema,
      },
      summary: "Create the billing manager's hosted portal session",
    },
    cancel: {
      method: "POST",
      path: "/organizations/:organizationId/billing/cancel",
      body: c.noBody(),
      responses: {
        200: billingCancellationResponseSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Cancel the organization's subscription at the end of the paid period",
      description:
        "Requires a browser session, the CSRF headers, and a single-use `cancellation` action token in `X-SendLit-Billing-Action-Token`. Paid access continues until `paidThroughAt`. Idempotent: an already scheduled cancellation returns 200.",
    },
    resume: {
      method: "POST",
      path: "/organizations/:organizationId/billing/resume",
      body: c.noBody(),
      responses: {
        200: billingCancellationResponseSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Resume a subscription that is scheduled to cancel",
      description:
        "Clears a cancellation scheduled for the end of the paid period. Uses a single-use `cancellation` action token. Returns 409 `operation_conflicted` (retryable) while a cancellation is still being sent to the payment provider.",
    },
    changePlan: {
      method: "POST",
      path: "/organizations/:organizationId/billing/plan-change",
      body: billingPlanChangeBodySchema,
      responses: {
        202: billingPlanChangeResponseSchema,
        200: billingPlanChangeResponseSchema,
        400: errorSchema,
        401: errorSchema,
        402: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
      summary: "Request a SendLit-owned organization plan change",
    },
    getPlanChange: {
      method: "GET",
      path: "/organizations/:organizationId/billing/plan-changes/:changeId",
      responses: {
        200: billingPlanChangeResponseSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: "Read a plan-change request status",
    },
  },
  { metadata: { tag: "Billing" } },
);

export const contract = c.router({
  contacts: contactsContract,
  segments: segmentsContract,
  tags: tagsContract,
  media: mediaContract,
  templates: templatesContract,
  sequences: sequencesContract,
  transactional: transactionalContract,
  events: eventsContract,
  settings: settingsContract,
  teams: teamsContract,
  organizations: organizationsContract,
  delivery: deliveryContract,
  provisioning: provisioningContract,
  overview: overviewContract,
  feedback: feedbackContract,
  deliveryEvents: deliveryEventsContract,
  suppressions: suppressionsContract,
  forms: formsContract,
  web: webIssuesContract,
  reputation: reputationContract,
  billing: billingContract,
});

export type Contract = typeof contract;
