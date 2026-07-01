import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/tokens";

export default async function Home() {
    const cookieStore = await cookies();
    const isAuthed =
        cookieStore.get(ACCESS_TOKEN_COOKIE) || cookieStore.get(REFRESH_TOKEN_COOKIE);
    redirect(isAuthed ? "/dashboard" : "/login");
}
