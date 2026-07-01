import { NextResponse } from "next/server";

export const ACCESS_TOKEN_COOKIE = "sendlit_access_token";
export const REFRESH_TOKEN_COOKIE = "sendlit_refresh_token";
export const OAUTH_STATE_COOKIE = "sendlit_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "sendlit_oauth_verifier";
/** Which team the dashboard is currently "in" — forwarded as the
 * `X-Sendlit-Team-Id` header by the BFF proxy so the API can resolve
 * `req.teamId` for this session (see `apps/api/src/auth/require-team.ts`).
 * Not a secret; just a stable selection, re-validated against team
 * membership by the API on every request. */
export const TEAM_ID_COOKIE = "sendlit_team_id";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const isProd = process.env.NODE_ENV === "production";

export function setTokenCookies(res: NextResponse, tokens: TokenResponse) {
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: tokens.expires_in ?? 900,
  });
  if (tokens.refresh_token) {
    res.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export function clearTokenCookies(res: NextResponse) {
  res.cookies.delete(ACCESS_TOKEN_COOKIE);
  res.cookies.delete(REFRESH_TOKEN_COOKIE);
}

export function clearOauthFlowCookies(res: NextResponse) {
  res.cookies.delete(OAUTH_STATE_COOKIE);
  res.cookies.delete(OAUTH_VERIFIER_COOKIE);
}
