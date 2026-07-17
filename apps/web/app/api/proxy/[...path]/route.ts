import { NextRequest, NextResponse } from "next/server";
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
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body,
        cache: "no-store",
    });

    const responseText = await upstream.text();
    const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);
    const res = new NextResponse(
        nullBodyStatuses.has(upstream.status) ? null : responseText,
        {
            status: upstream.status,
            headers: {
                "Content-Type":
                    upstream.headers.get("Content-Type") || "application/json",
            },
        },
    );

    if (upstream.status === 401) {
        res.headers.set("X-Auth-Error", "session_expired");
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
