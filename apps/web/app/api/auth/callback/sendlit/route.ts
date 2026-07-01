import { NextRequest, NextResponse } from "next/server";
import { getRedirectUri } from "@/lib/config";
import { exchangeCodeForTokens } from "@/lib/oauth-client";
import {
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    clearOauthFlowCookies,
    setTokenCookies,
} from "@/lib/tokens";

/** Handles the redirect back from `GET /oauth/authorize` on the API. */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const codeVerifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

    function failure(reason: string) {
        const res = NextResponse.redirect(
            new URL(`/login?error=${encodeURIComponent(reason)}`, req.url),
        );
        clearOauthFlowCookies(res);
        return res;
    }

    if (error) return failure(error);
    if (!code || !state || !codeVerifier || state !== expectedState) {
        return failure("invalid_state");
    }

    const tokens = await exchangeCodeForTokens({
        code,
        redirectUri: getRedirectUri(req.nextUrl.origin),
        codeVerifier,
    });

    if (!tokens) return failure("token_exchange_failed");

    const res = NextResponse.redirect(new URL("/dashboard", req.url));
    setTokenCookies(res, tokens);
    clearOauthFlowCookies(res);
    return res;
}
