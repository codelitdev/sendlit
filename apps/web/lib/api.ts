import { initClient } from "@ts-rest/core";
import {
    contactFilterSchema,
    contract,
    type CustomFields,
} from "@sendlit/api-contract";
import { ApiError } from "./api-client";
import {
    clearTeamIdCookie,
    isStaleTeamSelectionError,
    needsTeamSelection,
} from "./tokens";
import type {
    Contact,
    ContactFilterWithAggregator,
    EmailTemplate,
    MailType,
    Sequence,
    SequenceStats,
} from "@sendlit/email-blocks";
import type { Email } from "@sendlit/email-editor";

/**
 * Typed client generated from `@sendlit/api-contract` \u2014 the same contract
 * that validates requests/responses on the server and generates the OpenAPI
 * doc. Every exported function below is a thin wrapper preserving the exact
 * signatures/behaviour the dashboard pages already call (unwrap the body on
 * success, redirect on 401/needs-a-team, throw `ApiError` otherwise) so none
 * of them needed to change when this replaced the hand-written fetch client.
 */
const client = initClient(contract, {
    baseUrl: "/api/proxy",
    baseHeaders: {},
});

function toApiContactFilter(filter?: ContactFilterWithAggregator) {
    if (!filter) return undefined;

    const parsedFilter = contactFilterSchema.safeParse(filter);
    if (!parsedFilter.success) {
        throw new ApiError(400, "Invalid filter");
    }
    return parsedFilter.data;
}

async function unwrap<T>(
    promise: Promise<{ status: number; body: unknown }>,
): Promise<T> {
    const result = await promise;

    if (result.status >= 200 && result.status < 300) {
        return result.body as T;
    }

    if (result.status === 401 && typeof window !== "undefined") {
        window.location.href = "/login";
        // Never resolves \u2014 the browser is navigating away.
        return new Promise<T>(() => {});
    }

    const errorBody = result.body as { error?: string } | undefined;
    if (typeof window !== "undefined") {
        if (
            needsTeamSelection(result.status, errorBody?.error) &&
            !window.location.pathname.startsWith("/teams")
        ) {
            if (isStaleTeamSelectionError(errorBody?.error)) {
                clearTeamIdCookie();
            }
            window.location.href = "/teams";
            return new Promise<T>(() => {});
        }
    }

    throw new ApiError(
        result.status,
        errorBody?.error || `Request failed (${result.status})`,
    );
}

export interface Paginated<T> {
    items: T[];
    total: number;
}

export interface Media {
    mediaId: string;
    url: string;
    thumbnailUrl?: string | null;
    mediaLitId: string;
    fileName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    width?: number | null;
    height?: number | null;
    alt?: string | null;
    caption?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
}

export interface MediaReference {
    resourceType: "TEMPLATE" | "SEQUENCE_EMAIL";
    resourcePublicId: string;
    parentResourcePublicId?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
}

// ---- Teams ----------------------------------------------------------------

export interface Team {
    teamId: string;
    name: string;
    ownerAccountId?: string;
    externalId?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
}

export interface ApiKey {
    id: string;
    keyPrefix: string;
    name?: string | null;
    createdAt?: string | null;
}

export interface CreatedApiKey extends ApiKey {
    key: string;
}

export function listTeams() {
    return client.teams.list().then((result) => {
        if (result.status >= 200 && result.status < 300) {
            return result.body as { items: Team[] };
        }

        const errorBody = result.body as
            | { error?: string; teams?: Pick<Team, "teamId" | "name">[] }
            | undefined;
        if (result.status === 409 && errorBody?.teams) {
            return { items: errorBody.teams };
        }

        return unwrap<{ items: Team[] }>(Promise.resolve(result));
    });
}

export function createTeam(name: string) {
    return unwrap<Team>(client.teams.create({ body: { name } }));
}

export function renameTeam(teamId: string, name: string) {
    return unwrap<Team>(
        client.teams.rename({ params: { teamId }, body: { name } }),
    );
}

export function deleteTeam(teamId: string) {
    return unwrap<void>(client.teams.remove({ params: { teamId } }));
}

export function listTeamKeys(teamId: string) {
    return unwrap<{ items: ApiKey[] }>(
        client.teams.listKeys({ params: { teamId } }),
    );
}

export function createTeamKey(teamId: string, name: string) {
    return unwrap<CreatedApiKey>(
        client.teams.createKey({ params: { teamId }, body: { name } }),
    );
}

export function deleteTeamKey(teamId: string, key: string) {
    return unwrap<void>(
        client.teams.removeKey({ params: { teamId, keyId: key } }),
    );
}

// ---- Contacts ----------------------------------------------------------

export function listContacts(
    params: {
        q?: string;
        segmentId?: string;
        filter?: ContactFilterWithAggregator;
        offset?: number;
    } = {},
) {
    const filter = toApiContactFilter(params.filter);
    return unwrap<Paginated<Contact>>(
        client.contacts.list({
            query: {
                q: params.q,
                segmentId: params.segmentId,
                filter: filter ? JSON.stringify(filter) : undefined,
                offset: params.offset,
            },
        }),
    );
}

export function createContact(input: {
    email: string;
    name?: string;
    tags?: string[];
    customFields?: CustomFields;
}) {
    return unwrap<Contact>(client.contacts.create({ body: input }));
}

export function getContact(contactId: string) {
    return unwrap<Contact>(client.contacts.get({ params: { contactId } }));
}

export function updateContact(
    contactId: string,
    patch: Partial<
        Pick<Contact, "name" | "subscribed" | "tags" | "customFields">
    >,
) {
    return unwrap<Contact>(
        client.contacts.update({ params: { contactId }, body: patch as any }),
    );
}

export function addContactTag(contactId: string, tag: string) {
    return unwrap<Contact>(
        client.contacts.addTag({ params: { contactId, tag } }),
    );
}

export function removeContactTag(contactId: string, tag: string) {
    return unwrap<Contact>(
        client.contacts.removeTag({ params: { contactId, tag } }),
    );
}

export function deleteContact(contactId: string) {
    return unwrap<void>(client.contacts.remove({ params: { contactId } }));
}

export interface ContactDelivery {
    sequenceId: string;
    sequenceTitle: string;
    sequenceType: MailType;
    emailId: string;
    createdAt: string;
}

export function getContactDeliveries(contactId: string) {
    return unwrap<ContactDelivery[]>(
        client.contacts.deliveries({ params: { contactId } }),
    );
}

// ---- Segments --------------------------------------------------------------

export interface Segment {
    segmentId: string;
    name: string;
    filter: ContactFilterWithAggregator;
    createdAt: string | null;
    updatedAt: string | null;
}

export function listSegments() {
    return unwrap<Segment[]>(client.segments.list());
}

export function createSegment(input: {
    name: string;
    filter: ContactFilterWithAggregator;
}) {
    const filter = toApiContactFilter(input.filter);
    if (!filter) throw new ApiError(400, "Invalid filter");
    return unwrap<Segment>(
        client.segments.create({ body: { name: input.name, filter } }),
    );
}

export function deleteSegment(segmentId: string) {
    return unwrap<void>(client.segments.remove({ params: { segmentId } }));
}

// ---- Media --------------------------------------------------------------

export function listMedia(
    params: { query?: string; page?: number; pageSize?: number } = {},
) {
    return unwrap<Paginated<Media>>(
        client.media.list({
            query: {
                query: params.query,
                page: params.page,
                pageSize: params.pageSize,
            },
        }),
    );
}

export function getMedia(mediaId: string) {
    return unwrap<Media>(client.media.get({ params: { mediaId } }));
}

export function updateMediaMetadata(
    mediaId: string,
    patch: { alt?: string | null; caption?: string | null },
) {
    return unwrap<Media>(
        client.media.update({ params: { mediaId }, body: patch }),
    );
}

export function deleteMedia(mediaId: string) {
    return unwrap<void>(client.media.remove({ params: { mediaId } }));
}

export function listMediaReferences(mediaId: string) {
    return unwrap<{ items: MediaReference[] }>(
        client.media.references({ params: { mediaId } }),
    );
}

// ---- Templates -----------------------------------------------------------

export interface SystemTemplate {
    templateId: string;
    title: string;
    description: string;
    content: Email;
}

/** Built-in starting templates (Announcement, New user welcome, Upsell
 * products, Newsletter, Blank) offered alongside a team's own templates. */
export function listSystemTemplates() {
    return unwrap<{ items: SystemTemplate[] }>(
        client.templates.listSystem(),
    ).then((res) => res.items);
}

export function listTemplates() {
    return unwrap<EmailTemplate[]>(client.templates.list());
}

export function createTemplate(input: { title: string; content: Email }) {
    return unwrap<EmailTemplate>(client.templates.create({ body: input }));
}

export function getTemplate(templateId: string) {
    return unwrap<EmailTemplate>(
        client.templates.get({ params: { templateId } }),
    );
}

export function updateTemplate(
    templateId: string,
    patch: { title?: string; content?: Email },
) {
    return unwrap<EmailTemplate>(
        client.templates.update({ params: { templateId }, body: patch }),
    );
}

export function deleteTemplate(templateId: string) {
    return unwrap<void>(client.templates.remove({ params: { templateId } }));
}

// ---- Sequences / broadcasts ----------------------------------------------

export function listSequences(type: MailType) {
    return unwrap<Paginated<Sequence>>(
        client.sequences.list({ query: { type } }),
    );
}

export function createSequence(input: {
    type: MailType;
    templateId: string;
    espId?: string;
}) {
    return unwrap<Sequence>(client.sequences.create({ body: input }));
}

export function getSequence(sequenceId: string) {
    return unwrap<Sequence>(client.sequences.get({ params: { sequenceId } }));
}

export function updateSequence(
    sequenceId: string,
    patch: {
        title?: string;
        triggerType?: string;
        triggerData?: string;
        filter?: ContactFilterWithAggregator;
        emailsOrder?: string[];
        /** `undefined` leaves the current selection unchanged; `null` clears
         * it so the team's default ESP resolves at start. Only settable while
         * the sequence/broadcast is still `draft` or `paused`. */
        espId?: string | null;
    },
) {
    const { filter, ...rest } = patch;
    return unwrap<Sequence>(
        client.sequences.update({
            params: { sequenceId },
            body: { ...rest, filter: toApiContactFilter(filter) },
        }),
    );
}

export function deleteSequence(sequenceId: string) {
    return unwrap<void>(client.sequences.remove({ params: { sequenceId } }));
}

export function addSequenceEmail(sequenceId: string, templateId: string) {
    return unwrap<Sequence>(
        client.sequences.addEmail({
            params: { sequenceId },
            body: { templateId },
        }),
    );
}

export function updateSequenceEmail(
    sequenceId: string,
    emailId: string,
    patch: {
        subject?: string;
        content?: Email;
        delayInMillis?: number;
        actionType?: string | null;
        actionData?: Record<string, unknown> | null;
        published?: boolean;
    },
) {
    return unwrap<Sequence>(
        client.sequences.updateEmail({
            params: { sequenceId, emailId },
            body: patch as any,
        }),
    );
}

export function deleteSequenceEmail(sequenceId: string, emailId: string) {
    return unwrap<Sequence>(
        client.sequences.removeEmail({ params: { sequenceId, emailId } }),
    );
}

export function startSequence(sequenceId: string) {
    return unwrap<Sequence>(client.sequences.start({ params: { sequenceId } }));
}

export function pauseSequence(sequenceId: string) {
    return unwrap<Sequence>(client.sequences.pause({ params: { sequenceId } }));
}

export function getSequenceStats(sequenceId: string) {
    return unwrap<SequenceStats>(
        client.sequences.stats({ params: { sequenceId } }),
    );
}

export interface Overview {
    activeSequences: number;
    ongoingContacts: number;
    scheduledBroadcasts: number;
    mail: { sent: number; queued: number; failed: number; bounced: number };
    quota: {
        dailyUsed: number;
        dailyLimit: number;
        monthlyUsed: number;
        monthlyLimit: number;
    };
}
export function getOverview() {
    return unwrap<Overview>(client.overview.get());
}

// ---- ESP (email sending provider) ----------------------------------------

export type EspProvider =
    "smtp" | "sendgrid" | "mailgun" | "postmark" | "ses" | "resend" | "custom";

export interface EspConfig {
    espId: string;
    name: string;
    isDefault: boolean;
    provider: EspProvider;
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
    hasPassword: boolean;
    fromName: string | null;
    fromEmail: string | null;
    lastTestedAt: string | null;
    lastTestStatus: "success" | "failed" | null;
    lastTestError: string | null;
    updatedAt: string;
}

export interface EspConnectionInput {
    provider: EspProvider;
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    /** Omit to keep the existing secret unchanged; send "" to clear it. */
    password?: string;
    fromName?: string;
    fromEmail?: string;
}

/** Backward-compatible singleton alias over the team's default ESP — prefer
 * the collection functions below (`listEsps`/`createEsp`/...) for new UI. */
export function getEspConfig() {
    return unwrap<EspConfig | null>(client.settings.esp.get());
}

export function updateEspConfig(input: EspConnectionInput) {
    return unwrap<EspConfig>(client.settings.esp.upsert({ body: input }));
}

export function deleteEspConfig() {
    return unwrap<void>(client.settings.esp.remove());
}

export function testEspConfig(to?: string) {
    return unwrap<{ success: boolean; error?: string }>(
        client.settings.esp.test({ body: { to } }),
    );
}

// ---- ESP collection (multiple user-managed ESPs per team) -----------------

export function listEsps() {
    return unwrap<{ items: EspConfig[] }>(client.settings.esps.list());
}

export function createEsp(
    input: EspConnectionInput & { name: string; isDefault?: boolean },
) {
    return unwrap<EspConfig>(client.settings.esps.create({ body: input }));
}

export function getEsp(espId: string) {
    return unwrap<EspConfig>(client.settings.esps.get({ params: { espId } }));
}

export function updateEsp(
    espId: string,
    patch: Partial<EspConnectionInput> & {
        name?: string;
        /** A default can only be replaced by promoting another ESP. */
        isDefault?: true;
    },
) {
    return unwrap<EspConfig>(
        client.settings.esps.update({ params: { espId }, body: patch }),
    );
}

/** Throws `ApiError(409, ...)` when the ESP is referenced by an
 * active/paused sequence or a queued transactional email. */
export function deleteEsp(espId: string) {
    return unwrap<void>(client.settings.esps.remove({ params: { espId } }));
}

export function testEsp(espId: string, to?: string) {
    return unwrap<{ success: boolean; error?: string }>(
        client.settings.esps.test({ params: { espId }, body: { to } }),
    );
}

// ---- Bounce/complaint delivery feedback ------------------------------------

/** Providers with a reviewed webhook adapter — see
 * `docs/bounces-and-complaints.md`. Only these can configure feedback. */
export const feedbackCapableProviders: EspProvider[] = [
    "resend",
    "postmark",
    "sendgrid",
    "mailgun",
];

export type FeedbackConnectionStatus =
    "pending" | "healthy" | "stale" | "error" | "retiring" | "disabled";

export interface FeedbackConnection {
    connectionId: string;
    espId: string;
    provider: string;
    webhookUrl: string;
    hasCredential: boolean;
    status: FeedbackConnectionStatus;
    lastReceivedAt?: string | null;
    lastVerifiedAt?: string | null;
    lastErrorCode?: string | null;
}

export function getEspFeedback(espId: string) {
    return unwrap<FeedbackConnection | null>(
        client.feedback.get({ params: { espId } }),
    );
}

export function upsertEspFeedback(
    espId: string,
    input: { credential: string; expectedTopicArn?: string },
) {
    return unwrap<FeedbackConnection>(
        client.feedback.upsert({ params: { espId }, body: input }),
    );
}

export function rotateEspFeedback(
    espId: string,
    input: { credential: string; expectedTopicArn?: string },
) {
    return unwrap<FeedbackConnection>(
        client.feedback.rotate({ params: { espId }, body: input }),
    );
}

export function testEspFeedback(espId: string) {
    return unwrap<{ success: boolean; error?: string }>(
        client.feedback.test({ params: { espId } }),
    );
}

export function deleteEspFeedback(espId: string) {
    return unwrap<void>(client.feedback.remove({ params: { espId } }));
}

export type DeliveryEventType =
    | "accepted"
    | "delivered"
    | "delayed"
    | "soft_bounce"
    | "hard_bounce"
    | "failed"
    | "complaint"
    | "suppressed"
    | "rejected"
    | "unknown";

export interface DeliveryEvent {
    eventId: string;
    provider: string;
    espId: string | null;
    deliveryRoute: "custom" | "platform" | null;
    messageId: string | null;
    recipientEmail: string | null;
    eventType: DeliveryEventType;
    bounceClass?: "permanent" | "transient" | "undetermined" | null;
    reason?: string | null;
    occurredAt: string;
    receivedAt: string;
}

export function listDeliveryEvents(
    params: {
        espId?: string;
        eventType?: DeliveryEventType;
        offset?: number;
        itemsPerPage?: number;
    } = {},
) {
    return unwrap<Paginated<DeliveryEvent>>(
        client.deliveryEvents.list({ query: params }),
    );
}

export type SuppressionReason =
    | "hard_bounce"
    | "complaint"
    | "repeated_soft_bounce"
    | "provider_suppression"
    | "manual";

export interface Suppression {
    suppressionId: string;
    recipientEmail: string | null;
    reason: SuppressionReason;
    active: boolean;
    firstSuppressedAt: string;
    lastSuppressedAt: string;
    releasedAt?: string | null;
    releaseReason?: string | null;
}

const ownerReleasableSuppressionReasons: SuppressionReason[] = [
    "hard_bounce",
    "repeated_soft_bounce",
    "manual",
];

export function isSuppressionOwnerReleasable(
    reason: SuppressionReason,
): boolean {
    return ownerReleasableSuppressionReasons.includes(reason);
}

export function listSuppressions(
    params: {
        active?: boolean;
        reason?: SuppressionReason;
        offset?: number;
        itemsPerPage?: number;
    } = {},
) {
    return unwrap<Paginated<Suppression>>(
        client.suppressions.list({ query: params }),
    );
}

export function releaseSuppression(
    suppressionId: string,
    explanation?: string,
) {
    return unwrap<Suppression>(
        client.suppressions.release({
            params: { suppressionId },
            body: { explanation },
        }),
    );
}

// ---- General settings -----------------------------------------------------

export interface GeneralSettings {
    mailingAddress: string | null;
    updatedAt?: string | null;
}

export function getGeneralSettings() {
    return unwrap<GeneralSettings>(client.settings.general.get());
}

export function updateGeneralSettings(input: { mailingAddress?: string }) {
    return unwrap<GeneralSettings>(
        client.settings.general.update({ body: input }),
    );
}

// ---- Transactional emails --------------------------------------------------

export interface TransactionalEmail {
    txeId: string;
    to: string;
    from: string | null;
    replyTo: string | null;
    subject: string;
    templateId: string | null;
    variables: Record<string, any>;
    status: "queued" | "sent" | "failed" | "bounced";
    error: string | null;
    trackOpens: boolean;
    trackClicks: boolean;
    openCount: number;
    clickCount: number;
    sentAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface TransactionalEmailDetail extends TransactionalEmail {
    html: string | null;
}

export function listTransactionalEmails(
    params: {
        status?: TransactionalEmail["status"];
        createdAfter?: number;
        createdBefore?: number;
        offset?: number;
        itemsPerPage?: number;
    } = {},
) {
    return unwrap<Paginated<TransactionalEmail>>(
        client.transactional.list({
            query: {
                status: params.status,
                createdAfter: params.createdAfter,
                createdBefore: params.createdBefore,
                offset: params.offset,
                itemsPerPage: params.itemsPerPage,
            },
        }),
    );
}

export function getTransactionalEmail(txeId: string) {
    return unwrap<TransactionalEmailDetail>(
        client.transactional.get({ params: { txeId } }),
    );
}
