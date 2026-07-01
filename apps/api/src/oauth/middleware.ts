import { verifyAccessToken } from "./jwt";

export async function validateBearerToken(
    bearer: string,
): Promise<{ accountId: string; clientId: string; scopes: string[] } | null> {
    const payload = verifyAccessToken(bearer);
    if (!payload) return null;
    return {
        accountId: payload.sub,
        clientId: payload.cid,
        scopes: payload.scope,
    };
}
