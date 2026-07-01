import { API_URL, OAUTH_CLIENT_ID } from "./config";
import type { TokenResponse } from "./tokens";

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
    const res = await fetch(`${API_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
        cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
}

export async function exchangeCodeForTokens({
    code,
    redirectUri,
    codeVerifier,
}: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
}): Promise<TokenResponse | null> {
    return tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: OAUTH_CLIENT_ID,
        code_verifier: codeVerifier,
    });
}

export async function refreshAccessToken(
    refreshToken: string,
): Promise<TokenResponse | null> {
    return tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
    });
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
        await fetch(`${API_URL}/oauth/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: refreshToken }),
            cache: "no-store",
        });
    } catch {
        // best-effort
    }
}
