import { NextResponse } from "next/server";
import { WEB_CLIENT } from "@/lib/config";

/**
 * Same-app Location value for a post-action redirect.
 *
 * Relative paths stay relative so the browser keeps the origin it actually
 * used. Building an absolute URL from `req.nextUrl.origin` is wrong behind
 * a reverse proxy (the standalone server binds `HOSTNAME=0.0.0.0`, so that
 * origin becomes `http://0.0.0.0:3000`). Building one from `WEB_CLIENT` is
 * also wrong when the user is on a local alias (e.g. `https://web.localhost`
 * while `WEB_CLIENT` is still `http://localhost:3000`).
 *
 * Only same-app targets are allowed (relative paths, or absolute URLs whose
 * origin matches `WEB_CLIENT`). Everything else falls back to `/`.
 */
export function safeAppRedirect(redirectTo: string): string {
    try {
        // Protocol-relative URLs (`//evil.example/...`) must not be treated
        // as relative paths — they would rewrite the host.
        if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
            return redirectTo;
        }

        const absolute = new URL(redirectTo);
        const appOrigin = new URL(WEB_CLIENT);
        if (absolute.origin === appOrigin.origin) {
            return `${absolute.pathname}${absolute.search}${absolute.hash}`;
        }
    } catch {
        // Invalid URL — fall through to the home path.
    }

    return "/";
}

/** 303 redirect that preserves cookies via `NextResponse`. */
export function appRedirect(redirectTo: string, status = 303): NextResponse {
    return new NextResponse(null, {
        status,
        headers: { Location: safeAppRedirect(redirectTo) },
    });
}
