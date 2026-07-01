import { NextRequest, NextResponse } from "next/server";
import { revokeRefreshToken } from "@/lib/oauth-client";
import { REFRESH_TOKEN_COOKIE, clearTokenCookies } from "@/lib/tokens";

export async function POST(req: NextRequest) {
    const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (refreshToken) {
        await revokeRefreshToken(refreshToken);
    }
    const res = NextResponse.redirect(new URL("/login", req.url));
    clearTokenCookies(res);
    return res;
}
