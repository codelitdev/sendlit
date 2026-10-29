import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { auth, SESSION_COOKIE_NAME } from "../auth/better-auth";
import { requireAuth } from "../auth/middleware";
import { dashboardSessionBoundary, ensureCsrfCookie } from "../billing/security";
import { getUser } from "../user/queries";
import {
  AccountDeletionBlockedError,
  type AccountDeletionPreview,
  deleteAccount,
  previewAccountDeletion,
} from "./delete";

/** The Better Auth email OTP type reserved for confirming account deletion. */
const DELETION_CODE_TYPE = "email-verification" as const;

const router = Router();
router.use("/account", requireAuth);
router.use("/account", (req, res, next) => {
  if ((req as any).authKind !== "session") {
    res.status(403).json({ error: "human_session_required" });
    return;
  }
  ensureCsrfCookie(req, res);
  next();
});
router.post(
  "/account/deletion/code",
  rateLimit({
    windowMs: 60_000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  }),
);

const s = initServer();

function serializePreview(preview: AccountDeletionPreview) {
  return {
    organizations: preview.organizations.map((organization) => ({
      organizationId: organization.organizationId,
      name: organization.name,
      status: organization.status as
        | "pending_payment"
        | "active"
        | "suspended"
        | "abandoned"
        | "closed",
      role: organization.role,
      action: organization.action,
      teamCount: organization.teamCount,
      blocker: organization.blocker,
    })),
    blocked: preview.blocked,
  };
}

async function currentUser(req: any) {
  const identity = await getUser(req.userId);
  return identity && !identity.deletedAt ? identity : null;
}

const impl = s.router(contract.account, {
  getDeletion: async ({ req }) => {
    const identity = await currentUser(req);
    if (!identity) return { status: 401, body: { error: "unauthorized" } };
    const preview = await previewAccountDeletion(identity.id);
    return {
      status: 200,
      body: { email: identity.email, ...serializePreview(preview) },
    };
  },
  sendDeletionCode: async ({ req, res }) => {
    const boundary = dashboardSessionBoundary(req, res);
    if (boundary) return boundary as any;
    const identity = await currentUser(req);
    if (!identity) return { status: 401, body: { error: "unauthorized" } };
    await auth.api.sendVerificationOTP({
      body: { email: identity.email, type: DELETION_CODE_TYPE },
    });
    return { status: 204, body: undefined };
  },
  delete: async ({ req, res, body }) => {
    const boundary = dashboardSessionBoundary(req, res);
    if (boundary) return boundary as any;
    const identity = await currentUser(req);
    if (!identity) return { status: 401, body: { error: "unauthorized" } };
    if (body.email.trim().toLowerCase() !== identity.email.toLowerCase()) {
      return { status: 400, body: { error: "email_mismatch" } };
    }
    try {
      await auth.api.checkVerificationOTP({
        body: { email: identity.email, type: DELETION_CODE_TYPE, otp: body.code },
      });
    } catch {
      return { status: 400, body: { error: "invalid_code" } };
    }
    try {
      await deleteAccount(identity.id);
    } catch (error) {
      if (error instanceof AccountDeletionBlockedError) {
        return {
          status: 409,
          body: {
            error: "account_deletion_blocked" as const,
            ...serializePreview(error.preview),
          },
        };
      }
      throw error;
    }
    // The session row is gone; clear the browser's cookie too.
    for (const name of [SESSION_COOKIE_NAME, `__Secure-${SESSION_COOKIE_NAME}`]) {
      res.clearCookie(name, {
        path: "/",
        ...(process.env.AUTH_COOKIE_DOMAIN
          ? { domain: process.env.AUTH_COOKIE_DOMAIN }
          : {}),
      });
    }
    return { status: 204, body: undefined };
  },
});

createExpressEndpoints(contract.account, impl, router);

export default router;
