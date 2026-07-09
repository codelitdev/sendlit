import { redirect } from "next/navigation";
import { API_URL, WEB_CLIENT } from "@/lib/config";

/**
 * `apps/api` hosts the only login UI (see the "Unified Login Screen"
 * addendum in `apps/api/docs/replace-oauth-server-with-better-auth.md`) —
 * the same page MCP/OAuth clients see at `/oauth/login`. This route just
 * bounces the browser there and back.
 */
export default function LoginPage() {
    const target = `${API_URL}/login?redirect=${encodeURIComponent(`${WEB_CLIENT}/dashboard`)}`;
    redirect(target);
}
