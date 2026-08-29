import {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, like, lte } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/better-auth";
import { db } from "../db/client";
import { verification } from "../db/schema";

export type BillingAction =
    | "organization_checkout"
    | "checkout"
    | "portal"
    | "plan_change"
    | "organization_close"
    | "pending_hide";

type ActionTokenValue = {
    userId: string;
    sessionId: string;
    action: BillingAction;
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
    const header =
        typeof req.headers?.cookie === "string" ? req.headers.cookie : "";
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
    res.append(
        "Set-Cookie",
        `sendlit_csrf=${token}; Path=/; SameSite=Lax${secure}`,
    );
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
    return (
        typeof target === "string" && target.length > 0 && target.length <= 300
    );
}

async function sessionContext(req: any) {
    const current = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!current?.session || current.user.id !== req.userId) return null;
    return current;
}

function commonBoundary(req: any, res: any): BillingSecurityFailure | null {
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

export async function issueBillingActionToken(
    req: any,
    res: any,
    action: BillingAction,
    target: string,
): Promise<BillingSecurityFailure | { token: string; expiresAt: string }> {
    const boundary = commonBoundary(req, res);
    if (boundary) return boundary;
    if (!validTarget(target)) {
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
        const authenticatedAt = new Date(current.session.createdAt).getTime();
        const maxAgeSeconds = Number(
            process.env.BILLING_RECENT_AUTH_MAX_AGE_SECONDS ?? 900,
        );
        if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
            return {
                status: 503,
                body: { error: "billing_provider_unavailable" },
            };
        }
        if (
            !Number.isFinite(authenticatedAt) ||
            Date.now() - authenticatedAt > maxAgeSeconds * 1000
        ) {
            return {
                status: 401,
                body: { error: "recent_authentication_required" },
            };
        }
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        const value: ActionTokenValue = {
            userId: req.userId,
            sessionId: current.session.id,
            action,
            target,
        };
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
    } catch {
        return { status: 503, body: { error: "billing_security_unavailable" } };
    }
}

export async function requireBillingAction(
    req: any,
    res: any,
    action: BillingAction,
    target: string,
): Promise<BillingSecurityFailure | null> {
    const boundary = commonBoundary(req, res);
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
