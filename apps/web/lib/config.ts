export const API_URL = process.env.API_URL || "http://localhost:4000";

/** The OAuth2 client registered statically on the API — see
 * `apps/api/src/oauth/model.ts`'s `STATIC_CLIENTS`. */
export const OAUTH_CLIENT_ID = "web-client";

export function getRedirectUri(origin: string): string {
    return `${origin}/api/auth/callback/sendlit`;
}
