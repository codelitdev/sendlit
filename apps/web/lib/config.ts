import { DEFAULT_MAX_UPLOAD_SIZE_BYTES } from "@/lib/media-limits";

export const API_URL = process.env.API_URL || "http://localhost:5000";
export const API_PUBLIC_URL =
    process.env.API_PUBLIC_URL || "http://localhost:5000";

/** This app's own public origin — sent to `apps/api`'s hosted login page
 * (`GET /login?redirect=...`) as where to bounce the browser back to after
 * sign-in. Must match a value `apps/api` allowlists (its own `WEB_CLIENT`
 * env var — see the "Unified Login Screen" addendum in
 * `apps/api/docs/replace-oauth-server-with-better-auth.md`). */
export const WEB_CLIENT = process.env.WEB_CLIENT || "http://localhost:3000";

/** Maximum size (bytes) accepted for image uploads in the email image
 * picker. Server-only: called from Server Components (see
 * `app/editor/layout.tsx`) and threaded down to client components via
 * `MaxUploadSizeProvider`, so it can be changed at deploy/container-start
 * time without rebuilding the app — unlike `NEXT_PUBLIC_*` vars. */
export function getMaxUploadSizeBytes() {
    const parsed = Number(process.env.MAX_UPLOAD_SIZE);
    return parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_SIZE_BYTES;
}
