import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  emailDeliveryEvents,
  espFeedbackConnections,
  espWebhookReceipts,
  eventDefinitions,
  reputationConnections,
  signupConfirmations,
  signupForms,
  teams,
  transactionalEmails,
} from "../db/schema";
import { anonymizeTeamRecipientsForPrivacyDeletion } from "../delivery-feedback/retention";

const BATCH_SIZE = 500;

/**
 * Erases the personal data an organization holds about its contacts, when
 * its last owner deletes their account (ADR 0009). The organization must
 * already be closed (`deleteOrganization`); this only removes people's data:
 *
 * - contacts, with their custom field values, events, enrolments and
 *   per-contact delivery rows (all cascade from `contacts`);
 * - pending and past signup confirmations;
 * - recipient addresses, rendered bodies and merge variables of
 *   transactional emails;
 * - recipient addresses on outbound messages, delivery events and
 *   suppressions. Suppression hashes stay so the address stays blocked if
 *   the data ever comes back;
 * - raw ESP webhook payloads and the last properties seen per event;
 * - reputation connections (Google account label and refresh token).
 *
 * Billing, audit and aggregate reporting rows have no personal data and
 * stay with the closed organization.
 */
export async function eraseOrganizationPersonalData(
  organizationId: string,
): Promise<{ contactsErased: number }> {
  const teamIds = (
    await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.organizationId, organizationId))
  ).map((team) => team.id);

  let contactsErased = 0;
  for (const teamId of teamIds) {
    contactsErased += await deleteTeamContacts(teamId);
    const forms = db
      .select({ id: signupForms.id })
      .from(signupForms)
      .where(eq(signupForms.teamId, teamId));
    await db
      .delete(signupConfirmations)
      .where(inArray(signupConfirmations.formId, forms));
    await db
      .update(transactionalEmails)
      .set({
        toEmail: "",
        replyTo: null,
        html: null,
        text: null,
        variables: {},
        headers: null,
        contactId: null,
      })
      .where(eq(transactionalEmails.teamId, teamId));
    await anonymizeTeamRecipientsForPrivacyDeletion(teamId);
    await db
      .update(eventDefinitions)
      .set({ lastProperties: null })
      .where(eq(eventDefinitions.teamId, teamId));
    await db
      .delete(reputationConnections)
      .where(eq(reputationConnections.teamId, teamId));
  }

  const connectionOwner =
    teamIds.length > 0
      ? or(
          eq(espFeedbackConnections.organizationId, organizationId),
          inArray(espFeedbackConnections.teamId, teamIds),
        )
      : eq(espFeedbackConnections.organizationId, organizationId);
  const connections = db
    .select({ id: espFeedbackConnections.id })
    .from(espFeedbackConnections)
    .where(connectionOwner);
  await db
    .update(espWebhookReceipts)
    .set({ encryptedPayload: null, safeHeaders: {} })
    .where(inArray(espWebhookReceipts.connectionId, connections));
  // Events the feedback pipeline never matched to a team.
  await db
    .update(emailDeliveryEvents)
    .set({ recipientEmail: null, normalizedRecipient: null })
    .where(inArray(emailDeliveryEvents.connectionId, connections));

  return { contactsErased };
}

/** Deletes a team's contacts in bounded batches; their dependants cascade. */
async function deleteTeamContacts(teamId: string): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.teamId, teamId))
      .limit(BATCH_SIZE);
    if (batch.length === 0) return total;
    await db.delete(contacts).where(
      inArray(
        contacts.id,
        batch.map((row) => row.id),
      ),
    );
    total += batch.length;
  }
}
