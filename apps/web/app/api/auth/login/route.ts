import { NextRequest, NextResponse } from "next/server";
import { API_URL, OAUTH_CLIENT_ID, getRedirectUri } from "@/lib/config";
import {
    generateCodeChallenge,
    generateCodeVerifier,
    generateState,
} from "@/lib/pkce";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from "@/lib/tokens";

/**
 * Kicks off the OAuth2 Authorization Code + PKCE flow against the SendLit
 * API. See `apps/api/src/oauth/routes.ts` for the counterpart.
 */
export async function GET(req: NextRequest) {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const redirectUri = getRedirectUri(req.nextUrl.origin);

    const authorizeUrl = new URL(`${API_URL}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    const res = NextResponse.redirect(authorizeUrl.toString());
    const isProd = process.env.NODE_ENV === "production";
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: 600,
    });
    res.cookies.set(OAUTH_VERIFIER_COOKIE, codeVerifier, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: 600,
    });
    return res;
}
