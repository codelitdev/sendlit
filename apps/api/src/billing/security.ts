import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { BillingWorkflowError } from "@codelitdev/billing/core";
import type {
  BillingActionGrant,
  BillingAction as EngineBillingAction,
} from "@codelitdev/billing/workflows";
import type { BillingGrantTarget } from "@codelitdev/platform/billing";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, gt, like, lte } from "drizzle-orm";
import { auth } from "../auth/better-auth";
import { db } from "../db/client";
import { organizationMembers, organizations, verification } from "../db/schema";
import {
  getBillingActionGrants,
  getPendingCheckoutResumeGrants,
  recentAuthMaxAgeMs,
} from "./engine";

export type BillingAction =
  | "organization_checkout"
  | "checkout"
  | "portal"
  | "plan_change"
  | "cancellation"
  | "organization_close"
  | "pending_hide";

/** Actions the billing engine consumes through Platform grants. The other
 * two (`organization_close`, `pending_hide`) are SendLit-only and keep the
 * legacy token format consumed by `requireBillingAction`. Both formats share
 * the `verification` table safely: each consumer rejects the other's JSON. */
type EngineHttpAction = Exclude<BillingAction, "organization_close" | "pending_hide">;
type LegacyAction = Extract<BillingAction, "organization_close" | "pending_hide">;

type ActionTokenValue = {
  userId: string;
  sessionId: string;
  action: LegacyAction;
  target: string;
};

export type BillingSecurityFailure = {
  status: 401 | 403 | 503;
  body: { error: string };
};

export const billingActions: readonly BillingAction[] = [
  "organization_checkout",
  "checkout",
  "portal",
  "plan_change",
  "cancellation",
  "organization_close",
  "pending_hide",
] as const;

export function billingMutationOrigin(req: any): boolean {
  if (!req.userId || req.authKind !== "session") return false;
  const originHeader =
    typeof req.headers.origin === "string" ? req.headers.origin : null;
  const refererHeader =
    typeof req.headers.referer === "string" ? req.headers.referer : null;
  let origin = originHeader;
  if (!origin && refererHeader) {
    try {
      origin = new URL(refererHeader).origin;
    } catch {
      origin = null;
    }
  }
  if (!origin) return false;
  const allowed = new Set<string>();
  for (const value of [process.env.API_PUBLIC_URL, process.env.WEB_CLIENT]) {
    if (!value) continue;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Startup configuration validation reports malformed URLs.
    }
  }
  return allowed.has(origin);
}

function cookieValue(req: any, name: string): string | null {
  const header = typeof req.headers?.cookie === "string" ? req.headers.cookie : "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

export function ensureCsrfCookie(req: any, res: any): string {
  const existing = cookieValue(req, "sendlit_csrf");
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `sendlit_csrf=${token}; Path=/; SameSite=Lax${secure}`);
  return token;
}

function csrfTokenMatches(req: any, res: any): boolean {
  const cookie = cookieValue(req, "sendlit_csrf");
  const header =
    typeof req.headers?.["x-sendlit-csrf"] === "string"
      ? req.headers["x-sendlit-csrf"]
      : "";
  if (!cookie || !header) {
    ensureCsrfCookie(req, res);
    return false;
  }
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validTarget(target: unknown): target is string {
  return typeof target === "string" && target.length > 0 && target.length <= 300;
}

async function sessionContext(req: any) {
  const current = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!current?.session || current.user.id !== req.userId) return null;
  return current;
}

/** Session-only, same-origin and CSRF checks for sensitive dashboard writes
 * (billing actions, account deletion). */
export function dashboardSessionBoundary(
  req: any,
  res: any,
): BillingSecurityFailure | null {
  if (!req.userId || req.authKind !== "session") {
    return {
      status: 403,
      body: { error: "billing_human_session_required" },
    };
  }
  if (!billingMutationOrigin(req)) {
    return { status: 403, body: { error: "csrf_origin_invalid" } };
  }
  if (!csrfTokenMatches(req, res)) {
    return { status: 403, body: { error: "csrf_token_invalid" } };
  }
  return null;
}

function isLegacyAction(action: BillingAction): action is LegacyAction {
  return action === "organization_close" || action === "pending_hide";
}

/** The engine grant target for an HTTP action. Engine actions are bound to
 * the internal organization ID at issue time, and only an owner can receive
 * one (the engine then checks that the owner is the payer). */
async function engineGrantTarget(
  userId: string,
  action: EngineHttpAction,
  target: string,
): Promise<
  | BillingSecurityFailure
  | {
      engineAction: EngineBillingAction;
      grantTarget: BillingGrantTarget;
      pendingPayment: boolean;
    }
> {
  if (action === "organization_checkout") {
    if (target !== "new") {
      return { status: 403, body: { error: "billing_action_invalid" } };
    }
    return {
      engineAction: "checkout",
      grantTarget: NEW_ORGANIZATION_TARGET,
      pendingPayment: false,
    };
  }
  const [row] = await db
    .select({
      id: organizations.id,
      status: organizations.status,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, organizations.id),
        eq(organizationMembers.userId, userId),
      ),
    )
    .where(eq(organizations.organizationId, target))
    .limit(1);
  if (!row) return { status: 403, body: { error: "billing_action_invalid" } };
  if (row.role !== "owner") {
    return { status: 403, body: { error: "billing_owner_required" } };
  }
  return {
    engineAction: action,
    grantTarget: { kind: "organization", id: row.id },
    pendingPayment: row.status === "pending_payment",
  };
}

/** Grant target for the paid-organization checkout token, consumed by
 * `POST /billing/organization-checkouts` before the organization exists. */
export const NEW_ORGANIZATION_TARGET: BillingGrantTarget = {
  kind: "new_organization",
  id: "new",
};

async function issueLegacyToken(
  userId: string,
  sessionId: string,
  action: LegacyAction,
  target: string,
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const value: ActionTokenValue = { userId, sessionId, action, target };
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(
        and(
          like(verification.identifier, "billing-action:%"),
          lte(verification.expiresAt, new Date()),
        ),
      );
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: `billing-action:${tokenHash(token)}`,
      value: JSON.stringify(value),
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function issueBillingActionToken(
  req: any,
  res: any,
  action: BillingAction,
  target: string,
): Promise<BillingSecurityFailure | { token: string; expiresAt: string }> {
  const boundary = dashboardSessionBoundary(req, res);
  if (boundary) return boundary;
  if (!validTarget(target) || !billingActions.includes(action)) {
    return { status: 403, body: { error: "billing_action_invalid" } };
  }
  try {
    const current = await sessionContext(req);
    if (!current) {
      return {
        status: 401,
        body: { error: "recent_authentication_required" },
      };
    }
    const maxAgeMs = recentAuthMaxAgeMs();
    if (maxAgeMs === null) {
      return {
        status: 503,
        body: { error: "billing_provider_unavailable" },
      };
    }
    const sessionCreatedAt = new Date(current.session.createdAt);
    if (Number.isNaN(sessionCreatedAt.getTime())) {
      return {
        status: 401,
        body: { error: "recent_authentication_required" },
      };
    }
    if (isLegacyAction(action)) {
      if (Date.now() - sessionCreatedAt.getTime() > maxAgeMs) {
        return {
          status: 401,
          body: { error: "recent_authentication_required" },
        };
      }
      return await issueLegacyToken(req.userId, current.session.id, action, target);
    }
    const resolved = await engineGrantTarget(req.userId, action, target);
    if ("status" in resolved) return resolved;
    // Finishing checkout for a pending organization keeps SendLit's
    // long-standing exemption from recent authentication; see
    // getPendingCheckoutResumeGrants for why.
    const grants =
      resolved.engineAction === "checkout" && resolved.pendingPayment
        ? getPendingCheckoutResumeGrants()
        : getBillingActionGrants();
    const issued = await grants.issue({
      actorId: req.userId,
      sessionId: current.session.id,
      sessionCreatedAt,
      action: resolved.engineAction,
      target: resolved.grantTarget,
    });
    if (!issued.ok) {
      return { status: 401, body: { error: issued.error } };
    }
    return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
  } catch {
    return { status: 503, body: { error: "billing_security_unavailable" } };
  }
}

/** Reads the action token for an engine route. The engine consumes it (via
 * the Platform authorization port) bound to this session, action and
 * organization. */
export async function readBillingActionToken(
  req: any,
  res: any,
  target: string,
): Promise<
  BillingSecurityFailure | { token: string; sessionId: string; sessionCreatedAt: Date }
> {
  const boundary = dashboardSessionBoundary(req, res);
  if (boundary) return boundary;
  const token =
    typeof req.headers?.["x-sendlit-billing-action-token"] === "string"
      ? req.headers["x-sendlit-billing-action-token"]
      : "";
  if (!token || !validTarget(target)) {
    return {
      status: 401,
      body: { error: "billing_action_token_required" },
    };
  }
  const current = await sessionContext(req).catch(() => null);
  if (!current) {
    return {
      status: 401,
      body: { error: "recent_authentication_required" },
    };
  }
  return {
    token,
    sessionId: current.session.id,
    sessionCreatedAt: new Date(current.session.createdAt),
  };
}

/** The grant an engine workflow consumes, built from a token the client sent. */
export function billingGrantFromToken(
  ready: { token: string; sessionId: string },
  actorId: string,
  action: EngineBillingAction,
  target: BillingGrantTarget,
): BillingActionGrant {
  return getBillingActionGrants().grant({
    token: ready.token,
    actorId,
    sessionId: ready.sessionId,
    action,
    target,
  });
}

/** Consumes the `organization_checkout` token at the route, before the
 * pending organization exists. The checkout itself then runs with a fresh
 * grant issued for the new organization (see createPaidOrganizationCheckout),
 * so no workflow ever sees a pre-consumed grant. */
export async function consumeNewOrganizationCheckoutToken(
  req: any,
  res: any,
): Promise<BillingSecurityFailure | { sessionId: string; sessionCreatedAt: Date }> {
  const ready = await readBillingActionToken(req, res, NEW_ORGANIZATION_TARGET.id);
  if ("status" in ready) return ready;
  const grants = getBillingActionGrants();
  const grant = grants.grant({
    token: ready.token,
    actorId: req.userId,
    sessionId: ready.sessionId,
    action: "checkout",
    target: NEW_ORGANIZATION_TARGET,
  });
  try {
    await grants.authorization.consume(
      grant,
      "checkout",
      NEW_ORGANIZATION_TARGET,
      new Date(),
    );
  } catch (error) {
    if (error instanceof BillingWorkflowError) {
      return { status: 401, body: { error: "billing_action_token_invalid" } };
    }
    return { status: 503, body: { error: "billing_security_unavailable" } };
  }
  return { sessionId: ready.sessionId, sessionCreatedAt: ready.sessionCreatedAt };
}

/** Legacy SendLit-only actions (`organization_close`, `pending_hide`). */
export async function requireBillingAction(
  req: any,
  res: any,
  action: LegacyAction,
  target: string,
): Promise<BillingSecurityFailure | null> {
  const boundary = dashboardSessionBoundary(req, res);
  if (boundary) return boundary;
  const token =
    typeof req.headers?.["x-sendlit-billing-action-token"] === "string"
      ? req.headers["x-sendlit-billing-action-token"]
      : "";
  if (!token || !validTarget(target)) {
    return {
      status: 401,
      body: { error: "billing_action_token_required" },
    };
  }
  try {
    const current = await sessionContext(req);
    if (!current) {
      return {
        status: 401,
        body: { error: "recent_authentication_required" },
      };
    }
    const identifier = `billing-action:${tokenHash(token)}`;
    const consumed = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(verification)
        .where(
          and(
            eq(verification.identifier, identifier),
            gt(verification.expiresAt, new Date()),
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return false;
      let value: ActionTokenValue;
      try {
        value = JSON.parse(row.value) as ActionTokenValue;
      } catch {
        return false;
      }
      if (
        value.userId !== req.userId ||
        value.sessionId !== current.session.id ||
        value.action !== action ||
        value.target !== target
      ) {
        return false;
      }
      await tx.delete(verification).where(eq(verification.id, row.id));
      return true;
    });
    return consumed
      ? null
      : { status: 401, body: { error: "billing_action_token_invalid" } };
  } catch {
    return { status: 503, body: { error: "billing_security_unavailable" } };
  }
}
