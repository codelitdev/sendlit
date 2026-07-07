import { redirect } from "next/navigation";
import { cookies } from "next/headers";

const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

export default async function Home() {
    const cookieStore = await cookies();
    const isAuthed = cookieStore.get(BETTER_AUTH_SESSION_COOKIE);
    redirect(isAuthed ? "/dashboard" : "/login");
}
