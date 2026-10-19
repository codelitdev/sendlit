import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { emailDomain, isDisposableDomain } from "../abuse/email-domains";
import { createContact, findContactByEmail, updateContact } from "../contacts/queries";
import { db } from "../db/client";
import { signupConfirmations, signupForms, teams } from "../db/schema";
import { getActiveSuppressionReasons } from "../delivery-feedback/suppression-queries";
import { captureEvent } from "../observability";
import logger from "../services/log";
import { consumeRateLimit } from "../services/rate-counter";
import { createTransactionalEmail } from "../transactional/queries";
import { normalizeEmail } from "../utils/email";
import { escapeHtml } from "../utils/html";
import { getSiteUrl } from "../utils/mail";

export type SignupForm = typeof signupForms.$inferSelect;

/** A form as the API returns it, with its hosted page URL. */
export function toPublicForm(form: SignupForm) {
  return {
    formId: form.formId,
    name: form.name,
    tags: form.tags,
    doubleOptIn: form.doubleOptIn,
    redirectUrl: form.redirectUrl,
    url: `${getSiteUrl()}/f/${form.formId}`,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}

const CONFIRMATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Submissions per client IP per hour, per form. */
const IP_LIMIT_PER_HOUR = 10;
/** Submissions per form per day, so a form can't be used to mail-bomb. */
const FORM_LIMIT_PER_DAY = 1_000;
/** Confirmation emails to one address per day. */
const ADDRESS_LIMIT_PER_DAY = 2;

export function listForms(teamId: string) {
  return db
    .select()
    .from(signupForms)
    .where(eq(signupForms.teamId, teamId))
    .orderBy(asc(signupForms.createdAt));
}

export async function getForm(
  teamId: string,
  formId: string,
): Promise<SignupForm | null> {
  const [row] = await db
    .select()
    .from(signupForms)
    .where(and(eq(signupForms.teamId, teamId), eq(signupForms.formId, formId)))
    .limit(1);
  return row ?? null;
}

/** A form by its public id, with its team's name, for the public pages. */
export async function getPublicForm(formId: string) {
  const [row] = await db
    .select({ form: signupForms, teamName: teams.name, teamStatus: teams.status })
    .from(signupForms)
    .innerJoin(teams, eq(teams.id, signupForms.teamId))
    .where(eq(signupForms.formId, formId))
    .limit(1);
  return row ?? null;
}

const cleanTags = (tags: string[] | undefined) =>
  tags ? [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))] : undefined;

export async function createForm(
  teamId: string,
  input: {
    name: string;
    tags?: string[];
    doubleOptIn?: boolean;
    redirectUrl?: string | null;
  },
): Promise<SignupForm> {
  const [row] = await db
    .insert(signupForms)
    .values({
      teamId,
      name: input.name,
      tags: cleanTags(input.tags) ?? [],
      doubleOptIn: input.doubleOptIn ?? true,
      redirectUrl: input.redirectUrl || null,
    })
    .returning();
  return row;
}

export async function updateForm(
  teamId: string,
  formId: string,
  input: {
    name?: string;
    tags?: string[];
    doubleOptIn?: boolean;
    redirectUrl?: string | null;
  },
): Promise<SignupForm | null> {
  const [row] = await db
    .update(signupForms)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.tags !== undefined && { tags: cleanTags(input.tags) }),
      ...(input.doubleOptIn !== undefined && { doubleOptIn: input.doubleOptIn }),
      ...(input.redirectUrl !== undefined && {
        redirectUrl: input.redirectUrl || null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(signupForms.teamId, teamId), eq(signupForms.formId, formId)))
    .returning();
  return row ?? null;
}

export async function deleteForm(teamId: string, formId: string): Promise<boolean> {
  const rows = await db
    .delete(signupForms)
    .where(and(eq(signupForms.teamId, teamId), eq(signupForms.formId, formId)))
    .returning({ id: signupForms.id });
  return rows.length > 0;
}

export type SignupOutcome =
  | "confirmation_sent"
  | "subscribed"
  | "rate_limited"
  | "invalid";

/** Subscribes (or resubscribes) a contact through a form and adds its tags.
 * Creating the contact fires "subscriber added" sequences, e.g. a welcome
 * email. */
async function subscribe(form: SignupForm, email: string, name?: string | null) {
  const existing = await findContactByEmail(form.teamId, email);
  if (!existing) {
    await createContact({
      teamId: form.teamId,
      email,
      name: name || undefined,
      tags: form.tags,
    });
    return;
  }
  await updateContact(form.teamId, existing.contactId, {
    subscribed: true,
    tags: [...new Set([...existing.tags, ...form.tags])],
    ...(name && !existing.name && { name }),
  });
}

/**
 * A public signup through a form. Double opt-in sends a confirmation email
 * and subscribes only once it's clicked; single opt-in subscribes new
 * addresses straight away but never resubscribes someone who unsubscribed.
 * Suppressed, disposable and rate-limited submissions are dropped quietly:
 * the caller always gets the same answer, so the form can't be used to find
 * out who is on the list.
 */
export async function submitSignup(input: {
  form: SignupForm;
  teamName: string;
  email: string;
  name?: string | null;
  ip?: string | null;
}): Promise<SignupOutcome> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return "invalid";
  const name = input.name?.trim().slice(0, 200) || null;
  const formKey = input.form.formId;
  if (
    !(await consumeRateLimit(
      `form-ip:${formKey}:${input.ip ?? "unknown"}`,
      IP_LIMIT_PER_HOUR,
      3_600,
    )) ||
    !(await consumeRateLimit(`form:${formKey}`, FORM_LIMIT_PER_DAY, 86_400))
  ) {
    return "rate_limited";
  }
  const expected = input.form.doubleOptIn ? "confirmation_sent" : "subscribed";
  if (isDisposableDomain(emailDomain(email))) return expected;
  if ((await getActiveSuppressionReasons(input.form.teamId, [email])).size > 0) {
    return expected;
  }

  if (!input.form.doubleOptIn) {
    const existing = await findContactByEmail(input.form.teamId, email);
    if (!existing) await subscribe(input.form, email, name);
    captureEvent({
      event: "signup_form_subscribed",
      source: "forms.submit",
      teamId: input.form.teamId,
    });
    return expected;
  }

  if (
    !(await consumeRateLimit(
      `form-address:${input.form.teamId}:${email}`,
      ADDRESS_LIMIT_PER_DAY,
      86_400,
    ))
  ) {
    return expected;
  }
  const token = randomBytes(24).toString("base64url");
  await db.insert(signupConfirmations).values({
    token,
    formId: input.form.id,
    email,
    name,
    expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
  });
  const link = `${getSiteUrl()}/f/confirm/${token}`;
  try {
    await createTransactionalEmail({
      teamId: input.form.teamId,
      to: email,
      subject: `Confirm your subscription to ${input.teamName}`,
      html: `<p>Please confirm that you want to receive emails from ${escapeHtml(input.teamName)}.</p><p><a href="${link}">Yes, subscribe me</a></p><p>If you didn't sign up, ignore this email and you won't hear from us.</p>`,
      text: `Please confirm that you want to receive emails from ${input.teamName}:\n${link}\n\nIf you didn't sign up, ignore this email and you won't hear from us.`,
    });
  } catch (error) {
    logger.warn(
      { form_id: input.form.formId, error: (error as Error).message },
      "signup confirmation email not sent",
    );
  }
  captureEvent({
    event: "signup_form_confirmation_sent",
    source: "forms.submit",
    teamId: input.form.teamId,
  });
  return expected;
}

/** Completes a double opt-in signup from the emailed link. */
export async function confirmSignup(
  token: string,
): Promise<{ status: "confirmed" | "invalid"; form?: SignupForm }> {
  const [row] = await db
    .select({ confirmation: signupConfirmations, form: signupForms })
    .from(signupConfirmations)
    .innerJoin(signupForms, eq(signupForms.id, signupConfirmations.formId))
    .where(
      and(
        eq(signupConfirmations.token, token),
        gt(signupConfirmations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return { status: "invalid" };
  // Link scanners and repeat clicks land here too; confirming twice is fine.
  if (!row.confirmation.confirmedAt) {
    const [claimed] = await db
      .update(signupConfirmations)
      .set({ confirmedAt: new Date() })
      .where(
        and(
          eq(signupConfirmations.id, row.confirmation.id),
          isNull(signupConfirmations.confirmedAt),
        ),
      )
      .returning({ id: signupConfirmations.id });
    if (claimed) {
      await subscribe(row.form, row.confirmation.email, row.confirmation.name);
      captureEvent({
        event: "signup_form_confirmed",
        source: "forms.confirm",
        teamId: row.form.teamId,
      });
    }
  }
  return { status: "confirmed", form: row.form };
}
