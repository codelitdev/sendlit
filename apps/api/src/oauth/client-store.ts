import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { oauthClients } from "../db/schema";

export interface StoredOauthClient {
    clientId: string;
    clientIdIssuedAt: number;
    redirectUris: string[];
    grantTypes: string[];
    tokenEndpointAuthMethod: string;
    clientName?: string | null;
    scope?: string | null;
}

export async function findClientByClientId(
    clientId: string,
): Promise<StoredOauthClient | null> {
    const [row] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);
    if (!row) return null;
    return {
        clientId: row.clientId,
        clientIdIssuedAt: row.clientIdIssuedAt,
        redirectUris: row.redirectUris,
        grantTypes: row.grantTypes,
        tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
        clientName: row.clientName,
        scope: row.scope,
    };
}

export async function createClient(client: StoredOauthClient): Promise<void> {
    await db.insert(oauthClients).values({
        clientId: client.clientId,
        clientIdIssuedAt: client.clientIdIssuedAt,
        redirectUris: client.redirectUris,
        grantTypes: client.grantTypes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        clientName: client.clientName ?? null,
        scope: client.scope ?? null,
    });
}
