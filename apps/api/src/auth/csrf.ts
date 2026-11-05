import { randomBytes, timingSafeEqual } from "node:crypto";

export type SessionBoundaryFailure = {
  status: 403;
  body: { error: string };
};

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

/** Session-only, same-origin and CSRF checks for sensitive dashboard writes
 * (billing actions, account deletion). */
export function dashboardSessionBoundary(
  req: any,
  res: any,
): SessionBoundaryFailure | null {
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
