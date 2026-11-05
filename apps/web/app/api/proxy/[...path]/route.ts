import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { TEAM_ID_COOKIE } from "@/lib/tokens";

/** True when the browser says the request came from this dashboard's own
 * origin. Browsers always send `Origin` on a non-GET fetch or form POST. */
function isSameOriginRequest(req: NextRequest): boolean {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (!source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/**
 * Same-origin dashboard proxy. Browser requests carry only httpOnly session
 * cookies; the API resolves those cookies and enforces team membership. No
 * dashboard access/refresh token pair is minted or refreshed in the BFF.
 */
async function forward(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const method = req.method;
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  // The API trusts the session cookie plus a double-submit token for writes.
  // The proxy attaches that token itself, so it must first prove the request
  // came from this dashboard and not from another origin (a sibling site, or
  // a page a tenant published on the API host).
  if (isMutation && !isSameOriginRequest(req)) {
    return NextResponse.json({ error: "csrf_origin_invalid" }, { status: 403 });
  }
  const cookieHeader = req.headers.get("cookie");
  const targetUrl = `${API_URL}/${path.join("/")}${req.nextUrl.search}`;
  // Establish the readable double-submit cookie on the first same-origin
  // request. It is not forwarded upstream on reads, preserving the proxy's
  // existing cookie/privacy behavior; mutation requests forward it.
  const csrfCookie = req.cookies.get("sendlit_csrf")?.value;
  const csrfToken = csrfCookie || randomBytes(32).toString("base64url");
  const forwardedCookie =
    isMutation && csrfToken
      ? cookieHeader
        ? csrfCookie
          ? cookieHeader
          : `${cookieHeader}; sendlit_csrf=${csrfToken}`
        : `sendlit_csrf=${csrfToken}`
      : cookieHeader;
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  const body = hasBody ? await req.text() : undefined;
  const forwardedFor = req.headers.get("x-forwarded-for");
  // The collection route lists/creates teams and must resolve without an
  // active team. Nested routes (for example `/teams/:teamId/keys`) manage
  // resources scoped to a team and therefore need the selected team header
  // when the account belongs to more than one team.
  const isTeamCollectionRoute = path.length === 1 && path[0] === "teams";
  const teamId = isTeamCollectionRoute
    ? undefined
    : req.cookies.get(TEAM_ID_COOKIE)?.value;

  const upstream = await fetch(targetUrl, {
    method,
    headers: {
      ...(teamId ? { "X-Sendlit-Team-Id": teamId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      ...(req.headers.get("origin") ? { Origin: req.headers.get("origin")! } : {}),
      ...(req.headers.get("referer") ? { Referer: req.headers.get("referer")! } : {}),
      ...(forwardedCookie ? { Cookie: forwardedCookie } : {}),
      ...(isMutation
        ? { "X-Sendlit-CSRF": req.headers.get("x-sendlit-csrf") || csrfToken }
        : {}),
      ...(req.headers.get("x-sendlit-billing-action-token")
        ? {
            "X-Sendlit-Billing-Action-Token": req.headers.get(
              "x-sendlit-billing-action-token",
            )!,
          }
        : {}),
    },
    body,
    cache: "no-store",
  });

  const responseText = await upstream.text();
  const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);
  const isNullBody = nullBodyStatuses.has(upstream.status);
  const res = new NextResponse(isNullBody ? null : responseText, {
    status: upstream.status,
    headers: isNullBody
      ? undefined
      : {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        },
  });

  // Nothing the API returns through here is a page to render. Tenant-authored
  // HTML (web views, archives) must never run on the dashboard origin, so
  // sandbox every response and stop the browser guessing a type.
  res.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  res.headers.set("X-Content-Type-Options", "nosniff");

  if (upstream.status === 401) {
    res.headers.set("X-Auth-Error", "session_expired");
  }
  for (const header of [
    "Cache-Control",
    "Content-Disposition",
    "ETag",
    "Referrer-Policy",
  ]) {
    const value = upstream.headers.get(header);
    if (value) res.headers.set(header, value);
  }
  if (!csrfCookie) {
    res.cookies.set("sendlit_csrf", csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return res;
}

export {
  forward as GET,
  forward as POST,
  forward as PATCH,
  forward as PUT,
  forward as DELETE,
};
