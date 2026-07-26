import { WEB_CLIENT } from "@/lib/config";

/**
 * Resolve a post-action redirect against this app's public origin
 * (`WEB_CLIENT`), not `req.url`.
 *
 * Behind a reverse proxy the Next.js standalone server binds to
 * `HOSTNAME=0.0.0.0`, so `req.url` / `req.nextUrl.origin` become
 * `http://0.0.0.0:3000` (or similar). Building `Location` from that sends
 * the browser to an unreachable address. `WEB_CLIENT` is already the
 * canonical public origin used for auth return URLs.
 *
 * Only same-origin targets are allowed (relative paths, or absolute URLs
 * whose origin matches `WEB_CLIENT`). Everything else falls back to `/`.
 */
export function safeAppRedirect(redirectTo: string): URL {
    const appOrigin = new URL(WEB_CLIENT);

    try {
        // Protocol-relative URLs (`//evil.example/...`) must not be treated
        // as relative paths — `new URL("//…", origin)` would rewrite the host.
        if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
            return new URL(redirectTo, appOrigin);
        }

        const absolute = new URL(redirectTo);
        if (absolute.origin === appOrigin.origin) {
            return absolute;
        }
    } catch {
        // Invalid URL — fall through to the home path.
    }

    return new URL("/", appOrigin);
}
