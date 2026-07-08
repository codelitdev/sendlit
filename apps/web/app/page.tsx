import { redirect } from "next/navigation";
import { hasServerSession } from "@/lib/server-session";

export default async function Home() {
    const isAuthed = await hasServerSession();
    redirect(isAuthed ? "/dashboard" : "/login");
}
