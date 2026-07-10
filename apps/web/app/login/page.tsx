import { redirect } from "next/navigation";
import { API_PUBLIC_URL, WEB_CLIENT } from "@/lib/config";
import { getDashboardLoginUrl } from "@/lib/login-url";

export const dynamic = "force-dynamic";

/**
 * `apps/api` hosts the only login UI (see the "Unified Login Screen"
 * addendum in `apps/api/docs/replace-oauth-server-with-better-auth.md`) —
 * the same page MCP/OAuth clients see at `/oauth/login`. This route just
 * bounces the browser there and back.
 */
export default function LoginPage() {
    redirect(
        getDashboardLoginUrl({
            apiPublicUrl: API_PUBLIC_URL,
            webClient: WEB_CLIENT,
        }),
    );
}
