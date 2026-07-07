import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

/** Server-side auth gate shared by the dashboard and editor layouts. */
export async function requireAuth() {
    const cookieStore = await cookies();
    const isAuthed = cookieStore.get(BETTER_AUTH_SESSION_COOKIE);
    if (!isAuthed) redirect("/login");
}
