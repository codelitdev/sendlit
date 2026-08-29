import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { API_URL } from "@/lib/config";
import { TEAM_ID_COOKIE } from "@/lib/tokens";

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
    const cookieHeader = req.headers.get("cookie");
    const targetUrl = `${API_URL}/${path.join("/")}${req.nextUrl.search}`;
    const method = req.method;
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
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
    const hasBody =
        method !== "GET" && method !== "HEAD" && method !== "DELETE";
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
            ...(req.headers.get("origin")
                ? { Origin: req.headers.get("origin")! }
                : {}),
            ...(req.headers.get("referer")
                ? { Referer: req.headers.get("referer")! }
                : {}),
            ...(forwardedCookie ? { Cookie: forwardedCookie } : {}),
            ...(req.headers.get("x-sendlit-csrf")
                ? { "X-Sendlit-CSRF": req.headers.get("x-sendlit-csrf")! }
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
                  "Content-Type":
                      upstream.headers.get("Content-Type") ||
                      "application/json",
              },
    });

    if (upstream.status === 401) {
        res.headers.set("X-Auth-Error", "session_expired");
    }
    for (const header of ["Cache-Control", "ETag", "Referrer-Policy"]) {
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
