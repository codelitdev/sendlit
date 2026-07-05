import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { refreshAccessToken } from "@/lib/oauth-client";
import {
    ACCESS_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    TEAM_ID_COOKIE,
    clearTokenCookies,
    setTokenCookies,
} from "@/lib/tokens";

/**
 * A same-origin BFF proxy: the browser only ever talks to `/api/proxy/*`
 * (with an httpOnly session cookie), never directly to the SendLit API or the
 * access/refresh tokens. Handles silent access-token refresh on 401s.
 */
async function forward(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    const { path } = await params;
    const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const teamId = req.cookies.get(TEAM_ID_COOKIE)?.value;

    if (!accessToken && !refreshToken) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const targetUrl = `${API_URL}/${path.join("/")}${req.nextUrl.search}`;
    const method = req.method;
    const hasBody =
        method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const body = hasBody ? await req.text() : undefined;

    let token = accessToken;
    let upstream = token
        ? await callUpstream(targetUrl, method, body, token, teamId)
        : null;

    let refreshedTokens: Awaited<ReturnType<typeof refreshAccessToken>> = null;
    if ((!upstream || upstream.status === 401) && refreshToken) {
        refreshedTokens = await refreshAccessToken(refreshToken);
        if (refreshedTokens) {
            token = refreshedTokens.access_token;
            upstream = await callUpstream(
                targetUrl,
                method,
                body,
                token,
                teamId,
            );
        }
    }

    if (!upstream) {
        // Refresh failed (e.g. concurrent requests raced on a rotating refresh
        // token). The session may still be alive — don't clear cookies and don't
        // signal the client to redirect. The next navigation will re-check via the
        // server-side layout.
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const responseText = await upstream.text();
    // Responses with these statuses are defined by the fetch spec to never
    // have a body — the Response constructor throws if you pass one
    // (even an empty string), so `DELETE` endpoints returning `204 No
    // Content` (contacts, templates, ESP config, ...) would otherwise 500.
    const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
    const res = new NextResponse(
        NULL_BODY_STATUSES.has(upstream.status) ? null : responseText,
        {
            status: upstream.status,
            headers: {
                "Content-Type":
                    upstream.headers.get("Content-Type") || "application/json",
            },
        },
    );

    if (refreshedTokens) {
        setTokenCookies(res, refreshedTokens);
    } else if (upstream.status === 401) {
        // The upstream explicitly rejected the (fresh or existing) access token —
        // the session is genuinely gone. Clear cookies so the server-side layout
        // will redirect to /login on the next navigation, and signal the client.
        clearTokenCookies(res);
        res.headers.set("X-Auth-Error", "session_expired");
    }

    return res;
}

async function callUpstream(
    url: string,
    method: string,
    body: string | undefined,
    accessToken: string,
    teamId: string | undefined,
): Promise<Response> {
    return fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(teamId ? { "X-Sendlit-Team-Id": teamId } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
        cache: "no-store",
    });
}

export {
    forward as GET,
    forward as POST,
    forward as PATCH,
    forward as PUT,
    forward as DELETE,
};
