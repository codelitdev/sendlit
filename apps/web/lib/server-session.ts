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

    try {
        const response = await fetch(`${API_URL}/api/auth/get-session`, {
            headers: { Cookie: cookieHeader },
            cache: "no-store",
        });
        if (!response.ok) return false;
        return hasUserSession(await response.json());
    } catch {
        // Auth is an availability boundary. A temporarily unreachable API
        // must not surface a Next.js error page or grant dashboard access.
        return false;
    }
}
