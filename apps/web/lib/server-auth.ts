import { redirect } from "next/navigation";
import { hasServerSession } from "./server-session";

/** Server-side auth gate shared by the dashboard and editor layouts. */
export async function requireAuth() {
    const isAuthed = await hasServerSession();
    if (!isAuthed) redirect("/login");
}
