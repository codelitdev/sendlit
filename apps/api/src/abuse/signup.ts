import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { organizationPlanPolicies, teams, user } from "../db/schema";
import { captureError } from "../observability";
import { sharedRedis } from "../services/redis-client";
import { abuseControlsEnabled, readAbuseConfig } from "./config";
import { emailDomain, isDisposableDomain, isFreeEmailDomain } from "./email-domains";
import { pauseTeamForReview, raiseAbuseFlag } from "./flags";
import { recordAbuseEvent } from "./telemetry";

/** Set by the API (from Express's `req.ip`, which honours
 * `ENABLE_TRUST_PROXY`) on every auth request; any client value is
 * overwritten, so Better Auth hooks can trust it. */
export const CLIENT_IP_HEADER = "x-sendlit-client-ip";

/** A signup the hosted guards refuse, with a message for the person. */
export class SignupBlockedError extends Error {
  constructor(
    readonly code: "disposable_email" | "free_email" | "too_many_signups",
    readonly userMessage: string,
  ) {
    super(code);
    this.name = "SignupBlockedError";
  }
}

function blockSignup(code: SignupBlockedError["code"], userMessage: string): never {
  recordAbuseEvent("signup_blocked", {
    source: "abuse.signup",
    properties: { reason: code },
  });
  throw new SignupBlockedError(code, userMessage);
}

function signupCounterKey(ip: string, now = new Date()) {
  return `sendlit:signups:${ip}:${now.toISOString().slice(0, 10)}`;
}

async function signupsToday(ip: string): Promise<number> {
  try {
    return Number((await sharedRedis().get(signupCounterKey(ip))) ?? 0);
  } catch (error) {
    captureError({ error, source: "abuse.signup_counter", severity: "warning" });
    return 0;
  }
}

/**
 * Hosted checks before a new account is created (and before its sign-in
 * code is sent): disposable domains, the free-provider policy and the
 * per-IP daily signup cap. Throws `SignupBlockedError`.
 */
export async function assertSignupAllowed(input: {
  email: string;
  ip?: string | null;
}): Promise<void> {
  if (!abuseControlsEnabled()) return;
  const config = readAbuseConfig();
  const domain = emailDomain(input.email);
  if (config.blockDisposableSignups && isDisposableDomain(domain)) {
    blockSignup(
      "disposable_email",
      "Disposable or temporary email addresses can't be used to sign up. Use your work or personal email.",
    );
  }
  if (config.freeEmailSignupPolicy === "block" && isFreeEmailDomain(domain)) {
    blockSignup("free_email", "Sign up with an email address on your own domain.");
  }
  if (input.ip && (await signupsToday(input.ip)) >= config.signupsPerIpPerDay) {
    blockSignup(
      "too_many_signups",
      "Too many accounts were created from your network today. Try again tomorrow or contact support.",
    );
  }
}

export async function isExistingUser(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return Boolean(row);
}

/**
 * How likely a signup is to be a throwaway account, 0 (a real company or
 * person) to 100, from Exa's web search: does the email's domain have a web
 * presence? Free mailboxes start in the middle. Returns null when the check
 * is off or fails.
 */
export async function assessSignupRisk(email: string): Promise<number | null> {
  const config = readAbuseConfig();
  const apiKey = process.env.EXA_API_KEY;
  if (config.signupRiskCheck !== "exa" || !apiKey) return null;
  const domain = emailDomain(email);
  const localPart = email.split("@")[0] ?? "";
  // Mostly digits or very long local parts are typical of generated accounts.
  const generatedLooking = /\d{4,}/.test(localPart) || localPart.length > 24;
  if (isFreeEmailDomain(domain)) return generatedLooking ? 70 : 40;
  try {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query: domain, includeDomains: [domain], numResults: 1 }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`exa_${response.status}`);
    const { results } = (await response.json()) as { results?: unknown[] };
    if (results?.length) return generatedLooking ? 30 : 10;
    return 80;
  } catch (error) {
    captureError({ error, source: "abuse.signup_risk", severity: "warning" });
    return null;
  }
}

/**
 * After a hosted account is created: counts it against the IP's daily cap,
 * flags free-provider signups for review (`flag` policy) and runs the
 * optional risk check. A high-risk account's team starts with sending
 * paused until an operator releases it.
 */
export async function recordSignup(input: {
  userId: string;
  email: string;
  organizationId: string | null;
  ip?: string | null;
}): Promise<void> {
  if (!abuseControlsEnabled()) return;
  const config = readAbuseConfig();
  if (input.ip) {
    try {
      const key = signupCounterKey(input.ip);
      await sharedRedis()
        .multi()
        .incr(key)
        .expire(key, 2 * 86_400)
        .exec();
    } catch (error) {
      captureError({ error, source: "abuse.signup_counter", severity: "warning" });
    }
  }
  if (!input.organizationId) return;

  const risk = await assessSignupRisk(input.email);
  if (risk !== null) {
    await db
      .insert(organizationPlanPolicies)
      .values({ organizationId: input.organizationId, signupRiskScore: risk })
      .onConflictDoUpdate({
        target: organizationPlanPolicies.organizationId,
        set: { signupRiskScore: risk, updatedAt: new Date() },
      });
  }
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.organizationId, input.organizationId))
    .limit(1);
  if (risk !== null && risk >= 70) {
    if (team) await pauseTeamForReview(team.id, "signup_review");
    await raiseAbuseFlag({
      organizationId: input.organizationId,
      teamId: team?.id,
      userId: input.userId,
      kind: "signup",
      severity: "high",
      reason: `High-risk signup (score ${risk}); sending paused until reviewed`,
      details: { email: input.email, riskScore: risk, ip: input.ip ?? null },
    });
    return;
  }
  if (
    config.freeEmailSignupPolicy === "flag" &&
    isFreeEmailDomain(emailDomain(input.email))
  ) {
    await raiseAbuseFlag({
      organizationId: input.organizationId,
      teamId: team?.id,
      userId: input.userId,
      kind: "signup",
      severity: "low",
      reason: "Signed up with a free email provider",
      details: { email: input.email, riskScore: risk, ip: input.ip ?? null },
    });
  }
}
