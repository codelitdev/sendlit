import { type Request, type Response, Router } from "express";
import { captureError } from "../observability";
import logger from "../services/log";
import { page } from "../tracking/unsubscribe-page";
import { escapeHtml } from "../utils/html";
import {
  confirmationSenderIssue,
  confirmSignup,
  getPublicForm,
  type SignupForm,
  submitSignup,
} from "./queries";

const router = Router();

const formPage = (formId: string, teamName: string, message = "") =>
  page(
    `Subscribe to ${teamName}`,
    `<h1>Subscribe to ${escapeHtml(teamName)}</h1>${message ? `<p>${escapeHtml(message)}</p>` : ""}<form method="post" action="/f/${encodeURIComponent(formId)}" style="display:grid;gap:.75rem;text-align:left"><label>Email<br><input type="email" name="email" required style="width:100%;padding:.5rem;box-sizing:border-box"></label><label>Name (optional)<br><input type="text" name="name" style="width:100%;padding:.5rem;box-sizing:border-box"></label><input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><button type="submit">Subscribe</button></form>`,
  );

const donePage = (teamName: string, doubleOptIn: boolean) =>
  page(
    "Thanks!",
    doubleOptIn
      ? `<h1>Check your inbox</h1><p>We sent you an email from ${escapeHtml(teamName)}. Click the link in it to confirm your subscription.</p>`
      : `<h1>You're subscribed</h1><p>Thanks for subscribing to ${escapeHtml(teamName)}.</p>`,
  );

const unavailablePage = () =>
  page(
    "Form not available",
    "<h1>This form isn't available</h1><p>The link may be wrong, or the form was removed.</p>",
  );

/** Only http(s) redirect targets, so a form can't send people to `javascript:`. */
function safeRedirect(form: SignupForm): string | null {
  try {
    const url = new URL(form.redirectUrl ?? "");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const wantsHtml = (req: Request) => !req.is("application/json");

const CANT_SEND = "This form can't accept signups right now. Please try again later.";

// The emailed link lands on a page with a button, so link scanners that
// open it don't subscribe anyone.
router.get("/f/confirm/:token", (_req: Request, res: Response) => {
  res
    .type("html")
    .send(
      page(
        "Confirm your subscription",
        `<h1>Confirm your subscription</h1><p>One more click and you're on the list.</p><form method="post"><button type="submit">Confirm subscription</button></form>`,
      ),
    );
});

// The click on the confirmation page; a GET (as link scanners do) never subscribes.
router.post("/f/confirm/:token", async (req: Request, res: Response) => {
  try {
    const { status, form } = await confirmSignup(req.params.token);
    if (status !== "confirmed" || !form) {
      return res
        .status(404)
        .type("html")
        .send(
          page(
            "Link expired",
            "<h1>This link has expired</h1><p>Sign up again to get a new one.</p>",
          ),
        );
    }
    const redirect = safeRedirect(form);
    if (redirect) return res.redirect(303, redirect);
    res
      .type("html")
      .send(
        page("Subscribed", "<h1>You're subscribed</h1><p>Thanks for confirming.</p>"),
      );
  } catch (error) {
    captureError({ error, source: "forms.confirm" });
    res.status(500).send("Something went wrong. Please try again.");
  }
});

// Hosted signup page.
router.get("/f/:formId", async (req: Request, res: Response) => {
  const found = await getPublicForm(req.params.formId);
  if (found?.teamStatus !== "active") {
    return res.status(404).type("html").send(unavailablePage());
  }
  res.type("html").send(formPage(found.form.formId, found.teamName));
});

// Submissions from the hosted page, embedded HTML forms and JSON clients.
router.post("/f/:formId", async (req: Request, res: Response) => {
  try {
    const found = await getPublicForm(req.params.formId);
    if (found?.teamStatus !== "active") {
      return wantsHtml(req)
        ? res.status(404).type("html").send(unavailablePage())
        : res.status(404).json({ error: "form_not_found" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Checked before looking at the address, so every visitor (and bot)
    // gets the same answer and the form still can't reveal who's listed.
    const senderIssue = found.form.doubleOptIn
      ? await confirmationSenderIssue(found.form.teamId)
      : null;
    if (senderIssue) {
      captureError({
        error: new Error(`confirmation_sender_unavailable: ${senderIssue}`),
        source: "forms.submit",
        teamId: found.form.teamId,
        context: { form_id: found.form.formId },
      });
    }
    // Bots fill the hidden field; humans can't see it. Pretend it worked.
    const outcome = senderIssue
      ? "unavailable"
      : typeof body.website === "string" && body.website
        ? found.form.doubleOptIn
          ? "confirmation_sent"
          : "subscribed"
        : await submitSignup({
            form: found.form,
            teamName: found.teamName,
            email: String(body.email ?? ""),
            name: typeof body.name === "string" ? body.name : null,
            ip: req.ip,
          });
    if (!wantsHtml(req)) {
      if (outcome === "invalid")
        return res.status(400).json({ error: "invalid_email" });
      if (outcome === "rate_limited")
        return res.status(429).json({ error: "too_many_requests" });
      if (outcome === "unavailable")
        return res.status(503).json({ error: "form_unavailable", message: CANT_SEND });
      return res.status(200).json({ status: outcome });
    }
    if (outcome === "invalid") {
      return res
        .status(400)
        .type("html")
        .send(
          formPage(found.form.formId, found.teamName, "Enter a valid email address."),
        );
    }
    if (outcome === "rate_limited") {
      return res
        .status(429)
        .type("html")
        .send(
          formPage(
            found.form.formId,
            found.teamName,
            "Too many signups right now. Try again later.",
          ),
        );
    }
    if (outcome === "unavailable") {
      return res
        .status(503)
        .type("html")
        .send(formPage(found.form.formId, found.teamName, CANT_SEND));
    }
    const redirect = safeRedirect(found.form);
    if (redirect) return res.redirect(303, redirect);
    res.type("html").send(donePage(found.teamName, found.form.doubleOptIn));
  } catch (error: any) {
    logger.error({ error: error.message }, "signup form submission failed");
    captureError({ error, source: "forms.submit" });
    res.status(500).send("Something went wrong. Please try again.");
  }
});

export default router;
