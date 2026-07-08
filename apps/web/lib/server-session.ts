import { cookies } from "next/headers";
import { API_URL } from "./config";

type SessionResponse = {
    user?: unknown;
};

function hasUserSession(body: unknown): body is SessionResponse {
    return (
        typeof body === "object" &&
        body !== null &&
        "user" in body &&
        Boolean((body as SessionResponse).user)
    );
}

export async function hasServerSession(): Promise<boolean> {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return false;

    const response = await fetch(`${API_URL}/api/auth/get-session`, {
        headers: { Cookie: cookieHeader },
        cache: "no-store",
    });

    if (!response.ok) return false;

    try {
        return hasUserSession(await response.json());
    } catch {
        return false;
    }
}
