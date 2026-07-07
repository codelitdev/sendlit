import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { TEAM_ID_COOKIE } from "@/lib/tokens";

const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

/**
 * Same-origin dashboard proxy. Browser requests carry only the Better Auth
 * httpOnly session cookie; the API resolves that session and enforces team
 * membership. No dashboard access/refresh token pair is minted or refreshed
 * in the BFF.
 */
async function forward(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    const { path } = await params;
    const cookieHeader = req.headers.get("cookie");
    const betterAuthSession = req.cookies.get(
        BETTER_AUTH_SESSION_COOKIE,
    )?.value;

    if (!betterAuthSession) {
        const res = NextResponse.json(
            { error: "unauthorized" },
            { status: 401 },
        );
        res.headers.set("X-Auth-Error", "session_expired");
        return res;
    }

    const targetUrl = `${API_URL}/${path.join("/")}${req.nextUrl.search}`;
    const method = req.method;
    const hasBody =
        method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const body = hasBody ? await req.text() : undefined;
    const forwardedFor = req.headers.get("x-forwarded-for");
    const isTeamManagementRoute = path[0] === "teams";
    const teamId = isTeamManagementRoute
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
