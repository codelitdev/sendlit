import { initClient } from "@ts-rest/core";
import { contract } from "@sendlit/api-contract";
import { ApiError } from "./api-client";
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

async function unwrap<T>(
  promise: Promise<{ status: number; body: unknown }>,
): Promise<T> {
  const result = await promise;

  if (result.status >= 200 && result.status < 300) {
    return result.body as T;
  }

  if (result.status === 401 && typeof window !== "undefined") {
    const headers = (result as any).headers as Headers | undefined;
    const sessionExpired = headers?.get("X-Auth-Error") === "session_expired";
    if (sessionExpired) {
      window.location.href = "/login";
      // Never resolves \u2014 the browser is navigating away.
      return new Promise<T>(() => {});
    }
    // Transient 401 (e.g. concurrent refresh race) \u2014 surface as a normal error
    // so the UI can show a toast/banner without killing the session.
  }

  const errorBody = result.body as { error?: string } | undefined;
  if (
    result.status === 409 &&
    (errorBody?.error === "team_required" || errorBody?.error === "no_team") &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/dashboard/teams")
  ) {
    window.location.href = "/dashboard/teams";
    return new Promise<T>(() => {});
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

// ---- Teams ----------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  ownerAccountId: string;
  fromName: string | null;
  fromEmail: string | null;
  mailingAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  teamId: string;
  key: string;
  name: string | null;
  createdAt: string;
}

export function listTeams() {
  return unwrap<{ items: Team[] }>(client.teams.list());
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
  return unwrap<ApiKey>(
    client.teams.createKey({ params: { teamId }, body: { name } }),
  );
}

export function deleteTeamKey(teamId: string, key: string) {
  return unwrap<void>(client.teams.removeKey({ params: { teamId, key } }));
}

// ---- Contacts ----------------------------------------------------------

export function listContacts(params: { q?: string; offset?: number } = {}) {
  return unwrap<Paginated<Contact>>(
    client.contacts.list({ query: { q: params.q, offset: params.offset } }),
  );
}

export function createContact(input: {
  email: string;
  name?: string;
  tags?: string[];
  customFields?: Record<string, string>;
}) {
  return unwrap<Contact>(client.contacts.create({ body: input }));
}

export function getContact(contactId: string) {
  return unwrap<Contact>(client.contacts.get({ params: { contactId } }));
}

export function updateContact(
  contactId: string,
  patch: Partial<
    Pick<Contact, "name" | "active" | "subscribedToUpdates" | "tags" | "customFields">
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

export function createSequence(input: { type: MailType; templateId: string }) {
  return unwrap<Sequence>(client.sequences.create({ body: input }));
}

export function getSequence(sequenceId: string) {
  return unwrap<Sequence>(client.sequences.get({ params: { sequenceId } }));
}

export function updateSequence(
  sequenceId: string,
  patch: {
    title?: string;
    fromName?: string;
    fromEmail?: string;
    triggerType?: string;
    triggerData?: string;
    filter?: ContactFilterWithAggregator;
    emailsOrder?: string[];
  },
) {
  return unwrap<Sequence>(
    client.sequences.update({ params: { sequenceId }, body: patch }),
  );
}

export function addSequenceEmail(sequenceId: string, templateId: string) {
  return unwrap<Sequence>(
    client.sequences.addEmail({ params: { sequenceId }, body: { templateId } }),
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

// ---- ESP (email sending provider) ----------------------------------------

export type EspProvider =
  "smtp" | "sendgrid" | "mailgun" | "postmark" | "ses" | "resend" | "custom";

export interface EspConfig {
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

export function getEspConfig() {
  return unwrap<EspConfig | null>(client.esp.get());
}

export function updateEspConfig(input: {
  provider: EspProvider;
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  /** Omit to keep the existing secret unchanged; send "" to clear it. */
  password?: string;
  fromName?: string;
  fromEmail?: string;
}) {
  return unwrap<EspConfig>(client.esp.upsert({ body: input }));
}

export function deleteEspConfig() {
  return unwrap<void>(client.esp.remove());
}

export function testEspConfig(to?: string) {
  return unwrap<{ success: boolean; error?: string }>(
    client.esp.test({ body: { to } }),
  );
}
