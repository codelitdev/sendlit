import { beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});

const mocks = {
  fireEvent: mock(async () => undefined),
  consumeRateLimit: mock(async () => true),
  createTransactionalEmail: mock(async (_input: any) => ({})),
  resolveDeliverySource: mock(async (..._args: any[]): Promise<any> => ({})),
  captureError: mock((_input: any) => undefined),
};
mock.module("../automation/fire-event", () => ({ fireEvent: mocks.fireEvent }));
mock.module("../services/rate-counter", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
mock.module("../transactional/queries", () => ({
  createTransactionalEmail: mocks.createTransactionalEmail,
}));
const realDelivery = await import("../delivery/queries");
mock.module("../delivery/queries", () => ({
  ...realDelivery,
  resolveDeliverySource: mocks.resolveDeliverySource,
}));
const realObservability = await import("../observability");
mock.module("../observability", () => ({
  ...realObservability,
  captureError: mocks.captureError,
}));

const { eq } = await import("drizzle-orm");
const { db } = await import("../db/client");
const { contacts, signupConfirmations } = await import("../db/schema");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
const { requestApp } = await import("../test/http");
const { addOrStrengthenSuppression } = await import(
  "../delivery-feedback/suppression-queries"
);
const { findContactByEmail } = await import("../contacts/queries");
const {
  confirmSignup,
  createForm,
  FormSenderError,
  submitSignup,
  toPublicForm,
  toPublicForms,
  updateForm,
} = await import("./queries");
const { default: publicRoutes } = await import("./public-routes");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(express.urlencoded({ extended: false }));
  instance.use(publicRoutes);
  return instance;
}

const confirmationToken = () =>
  String(
    mocks.createTransactionalEmail.mock.calls
      .at(-1)?.[0]
      ?.text.match(/\/f\/confirm\/(\S+)/)?.[1],
  );

beforeEach(async () => {
  mocks.fireEvent.mockClear();
  mocks.createTransactionalEmail.mockClear();
  mocks.createTransactionalEmail.mockImplementation(async () => ({}));
  mocks.resolveDeliverySource.mockImplementation(async () => ({}));
  mocks.captureError.mockClear();
  mocks.consumeRateLimit.mockImplementation(async () => true);
  await truncateAll(tdb);
});

describe("signup forms", () => {
  it("double opt-in subscribes with the form's tags only after the link is confirmed", async () => {
    const { team } = await seedTeamAndContact(tdb, { team: { name: "Acme" } });
    const form = await createForm(team.id, {
      name: "Newsletter",
      tags: ["news", " news ", "web"],
    });
    expect(form.tags).toEqual(["news", "web"]);
    expect(toPublicForm(form).url).toEndWith(`/f/${form.formId}`);

    const outcome = await submitSignup({
      form,
      teamName: "Acme",
      email: "New@Example.com",
      name: "Ann",
    });

    expect(outcome).toBe("confirmation_sent");
    expect(mocks.createTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(mocks.createTransactionalEmail.mock.calls[0][0]).toMatchObject({
      teamId: team.id,
      to: "new@example.com",
      subject: "Confirm your subscription to Acme",
    });
    expect(await findContactByEmail(team.id, "new@example.com")).toBeNull();

    const token = confirmationToken();
    expect((await confirmSignup(token)).status).toBe("confirmed");
    const contact = await findContactByEmail(team.id, "new@example.com");
    expect(contact).toMatchObject({
      subscribed: true,
      name: "Ann",
      tags: ["news", "web"],
    });
    expect(mocks.fireEvent).toHaveBeenCalled();

    // A second click (or a link scanner) is harmless.
    mocks.fireEvent.mockClear();
    expect((await confirmSignup(token)).status).toBe("confirmed");
    expect(mocks.fireEvent).not.toHaveBeenCalled();
  });

  it("rejects unknown and expired confirmation links", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter" });
    await submitSignup({ form, teamName: "Acme", email: "late@example.com" });
    const token = confirmationToken();
    await tdb
      .update(signupConfirmations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(signupConfirmations.token, token));

    expect((await confirmSignup(token)).status).toBe("invalid");
    expect((await confirmSignup("nope")).status).toBe("invalid");
    expect(await findContactByEmail(team.id, "late@example.com")).toBeNull();
  });

  it("confirming resubscribes an unsubscribed contact and merges tags", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      contact: { subscribed: false, tags: ["old"] },
    });
    const form = await createForm(team.id, { name: "Newsletter", tags: ["news"] });
    await submitSignup({ form, teamName: "Acme", email: contact.email });
    await confirmSignup(confirmationToken());

    expect(await findContactByEmail(team.id, contact.email)).toMatchObject({
      subscribed: true,
      tags: ["old", "news"],
    });
  });

  it("single opt-in subscribes new addresses but never resubscribes", async () => {
    const { team, contact } = await seedTeamAndContact(tdb, {
      contact: { subscribed: false },
    });
    const form = await createForm(team.id, {
      name: "Quick",
      doubleOptIn: false,
      tags: ["quick"],
    });

    expect(
      await submitSignup({ form, teamName: "Acme", email: "fresh@example.com" }),
    ).toBe("subscribed");
    expect(await findContactByEmail(team.id, "fresh@example.com")).toMatchObject({
      subscribed: true,
      tags: ["quick"],
    });

    expect(await submitSignup({ form, teamName: "Acme", email: contact.email })).toBe(
      "subscribed",
    );
    expect((await findContactByEmail(team.id, contact.email))?.subscribed).toBe(false);
    expect(mocks.createTransactionalEmail).not.toHaveBeenCalled();
  });

  it("quietly drops suppressed and disposable addresses", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter" });
    await addOrStrengthenSuppression({
      teamId: team.id,
      recipientEmail: "bounced@example.com",
      reason: "hard_bounce",
      actorType: "system",
    });

    expect(
      await submitSignup({ form, teamName: "Acme", email: "bounced@example.com" }),
    ).toBe("confirmation_sent");
    expect(
      await submitSignup({ form, teamName: "Acme", email: "x@mailinator.com" }),
    ).toBe("confirmation_sent");
    expect(mocks.createTransactionalEmail).not.toHaveBeenCalled();
  });

  it("refuses invalid and rate-limited submissions", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter" });

    expect(await submitSignup({ form, teamName: "Acme", email: "not-an-email" })).toBe(
      "invalid",
    );
    mocks.consumeRateLimit.mockImplementation(async () => false);
    expect(await submitSignup({ form, teamName: "Acme", email: "a@example.com" })).toBe(
      "rate_limited",
    );
    expect(mocks.createTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("public form routes", () => {
  const formPost = (path: string, body: Record<string, string>) =>
    requestApp(app(), path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  it("serves the hosted form and 404s unknown ones", async () => {
    const { team } = await seedTeamAndContact(tdb, { team: { name: "Acme" } });
    const form = await createForm(team.id, { name: "Newsletter" });

    const page = await requestApp(app(), `/f/${form.formId}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Subscribe to Acme");
    expect((await requestApp(app(), "/f/frm_missing")).status).toBe(404);
  });

  it("answers JSON submissions with a status code", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter", doubleOptIn: false });
    const post = (email: string) =>
      requestApp(app(), `/f/${form.formId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

    const ok = await post("json@example.com");
    expect(ok.status).toBe(200);
    expect(ok.json<{ status: string }>()).toEqual({ status: "subscribed" });
    expect((await post("bad")).status).toBe(400);
    mocks.consumeRateLimit.mockImplementation(async () => false);
    expect((await post("again@example.com")).status).toBe(429);
  });

  it("ignores honeypot submissions", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter", doubleOptIn: false });

    const response = await formPost(`/f/${form.formId}`, {
      email: "bot@example.com",
      website: "spam",
    });

    expect(response.status).toBe(200);
    expect(await findContactByEmail(team.id, "bot@example.com")).toBeNull();
  });

  it("redirects only to http(s) URLs after an HTML submission", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const safe = await createForm(team.id, {
      name: "Safe",
      doubleOptIn: false,
      redirectUrl: "https://example.com/thanks",
    });
    const unsafe = await createForm(team.id, {
      name: "Unsafe",
      doubleOptIn: false,
      redirectUrl: "javascript:alert(1)",
    });

    const redirected = await formPost(`/f/${safe.formId}`, { email: "a@example.com" });
    expect(redirected.status).toBe(303);
    expect(redirected.headers.location).toBe("https://example.com/thanks");

    const page = await formPost(`/f/${unsafe.formId}`, { email: "b@example.com" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("You're subscribed");
  });

  it("only subscribes when the confirmation page's button is pressed", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const form = await createForm(team.id, { name: "Newsletter" });
    await formPost(`/f/${form.formId}`, { email: "click@example.com" });
    const token = confirmationToken();

    const landing = await requestApp(app(), `/f/confirm/${token}`);
    expect(landing.body).toContain("Confirm subscription");
    expect(await findContactByEmail(team.id, "click@example.com")).toBeNull();

    const confirmed = await requestApp(app(), `/f/confirm/${token}`, {
      method: "POST",
    });
    expect(confirmed.status).toBe(200);
    const [row] = await tdb
      .select()
      .from(contacts)
      .where(eq(contacts.email, "click@example.com"));
    expect(row?.subscribed).toBe(true);
    expect(
      (await requestApp(app(), "/f/confirm/nope", { method: "POST" })).status,
    ).toBe(404);
  });

  describe("without a sender", () => {
    const noSender = () =>
      mocks.resolveDeliverySource.mockImplementation(async () => {
        throw new Error("delivery_source_unavailable");
      });

    it("refuses to create or switch on double opt-in, but allows single opt-in", async () => {
      const { team } = await seedTeamAndContact(tdb);
      noSender();

      const error = await createForm(team.id, { name: "Newsletter" }).catch((e) => e);
      expect(error).toBeInstanceOf(FormSenderError);
      expect(error.message).toBe("confirmation_sender_unavailable");
      expect(error.issue).toContain("no active sending mailbox");

      const single = await createForm(team.id, { name: "Single", doubleOptIn: false });
      expect(
        await updateForm(team.id, single.formId, { doubleOptIn: true }).catch((e) => e),
      ).toBeInstanceOf(FormSenderError);
      expect(
        (await updateForm(team.id, single.formId, { name: "Renamed" }))?.name,
      ).toBe("Renamed");
    });

    it("flags double opt-in forms that can no longer send", async () => {
      const { team } = await seedTeamAndContact(tdb);
      const double = await createForm(team.id, { name: "Double" });
      const single = await createForm(team.id, { name: "Single", doubleOptIn: false });
      // An already double opt-in form can still be edited once the sender goes.
      noSender();
      await updateForm(team.id, double.formId, { name: "Double!", doubleOptIn: true });

      const [doubleView, singleView] = await toPublicForms(team.id, [double, single]);
      expect(doubleView.sendingIssue).toContain("no active sending mailbox");
      expect(singleView.sendingIssue).toBeNull();
      mocks.resolveDeliverySource.mockImplementation(async () => ({}));
      expect((await toPublicForms(team.id, [double]))[0].sendingIssue).toBeNull();
    });

    it("answers every submission with the same error and reports it", async () => {
      const { team } = await seedTeamAndContact(tdb, { team: { name: "Acme" } });
      const form = await createForm(team.id, { name: "Newsletter" });
      await addOrStrengthenSuppression({
        teamId: team.id,
        recipientEmail: "gone@example.com",
        reason: "hard_bounce",
        actorType: "system",
      });
      noSender();
      const post = (body: Record<string, string>) =>
        requestApp(app(), `/f/${form.formId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      for (const body of <Record<string, string>[]>[
        { email: "new@example.com" },
        { email: "gone@example.com" },
        { email: "bot@example.com", website: "spam" },
      ]) {
        const response = await post(body);
        expect(response.status).toBe(503);
        expect(response.json()).toMatchObject({ error: "form_unavailable" });
      }
      const page = await formPost(`/f/${form.formId}`, { email: "html@example.com" });
      expect(page.status).toBe(503);
      expect(page.body).toContain("can&#39;t accept signups right now");
      expect(mocks.createTransactionalEmail).not.toHaveBeenCalled();
      expect(mocks.captureError).toHaveBeenCalledTimes(4);
      expect(mocks.captureError.mock.calls[0][0]).toMatchObject({
        source: "forms.submit",
        teamId: team.id,
        context: { form_id: form.formId },
      });
    });

    it("reports a confirmation email that fails to send", async () => {
      const { team } = await seedTeamAndContact(tdb);
      const form = await createForm(team.id, { name: "Newsletter" });
      mocks.createTransactionalEmail.mockImplementation(async () => {
        throw new Error("esp_not_configured");
      });

      expect(
        await submitSignup({ form, teamName: "Acme", email: "new@example.com" }),
      ).toBe("unavailable");
      expect(mocks.captureError.mock.calls[0][0]).toMatchObject({
        source: "forms.confirmation_email",
        teamId: team.id,
      });
    });
  });
});
