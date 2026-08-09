import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const bodyForbiddenResponseStatuses = new Set([204, 205, 304]);
const vscodeClientMetadataUrl = "https://vscode.dev/oauth/client-metadata.json";
const claudeClientMetadataUrl =
    "https://claude.ai/oauth/mcp-oauth-client-metadata";
const deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code";
const jwtBearerGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ignoredGrantTypesByClientMetadataUrl = new Map<string, Set<string>>([
    [vscodeClientMetadataUrl, new Set([deviceCodeGrantType])],
    [claudeClientMetadataUrl, new Set([jwtBearerGrantType])],
]);

/** Reject every IPv4 range and IPv6 address class that must never be fetched
 * as a client-metadata origin. This intentionally permits only globally
 * routable unicast addresses; it is used after DNS resolution, not for user
 * supplied hostnames. */
function isPublicRoutableAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) {
        const [a, b, c] = address.split(".").map(Number);
        if (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 0 && (c === 0 || c === 2 || c === 88)) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 198 && b === 51 && c === 100) ||
            (a === 203 && b === 0 && c === 113)
        ) {
            return false;
        }
        return true;
    }

    if (family === 6) {
        // Global-unicast IPv6 is exactly 2000::/3. This excludes unspecified,
        // loopback, IPv4-mapped, unique-local, link-local, multicast, and
        // documentation/reserved ranges without needing a second IP parser.
        const firstHextet = Number.parseInt(address.split(":")[0] || "0", 16);
        return firstHextet >= 0x2000 && firstHextet <= 0x3fff;
    }

    return false;
}

function toResponseHeaders(
    headers: Record<string, string | string[] | undefined>,
) {
    const result = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const item of value) result.append(name, item);
        } else if (value !== undefined) {
            result.append(name, value);
        }
    }
    return result;
}

/**
 * Fetch a CIMD document without allowing DNS rebinding or redirects.
 *
 * This is intentionally equivalent to Better Auth's secure Node fetcher, but
 * correctly supports Node 24's `lookup(..., { all: true })` callback contract.
 * The 1.7.0-rc.4 helper returns one address for that mode, which makes every
 * public CIMD request fail in Node 24 with ERR_INVALID_IP_ADDRESS.
 */
const fetchPinnedClientMetadataResource: ClientMetadataResourceFetch = async (
    input,
    init,
) => {
    const webRequest = new Request(input, init);
    const url = new URL(webRequest.url);
    if (url.protocol !== "https:") {
        throw new TypeError("CIMD Node transport requires an HTTPS URL");
    }
    if (webRequest.method !== "GET" && webRequest.method !== "HEAD") {
        throw new TypeError("CIMD Node transport supports only GET and HEAD");
    }

    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
        throw new TypeError("metadata hostname returned no DNS addresses");
    }
    for (const address of addresses) {
        if (!isPublicRoutableAddress(address.address)) {
            throw new TypeError(
                "metadata hostname must resolve only to public-routable addresses",
            );
        }
    }
    const pinnedAddress = addresses[0];
    const headers = Object.fromEntries(webRequest.headers.entries());
    headers.host = url.host;
    const signal =
        init?.signal ??
        (input instanceof Request ? input.signal : webRequest.signal);

    return new Promise<Response>((resolve, reject) => {
        const nodeRequest = request(
            url,
            {
                agent: false,
                headers,
                method: webRequest.method,
                servername:
                    isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
                        ? url.hostname
                        : undefined,
                signal,
                lookup: (_hostname, options, callback) => {
                    // Node 24 enables `all` when establishing a connection.
                    // In that mode Node requires `LookupAddress[]`, not the
                    // traditional `(address, family)` callback values.
                    if (options.all) {
                        callback(null, [pinnedAddress]);
                        return;
                    }
                    callback(null, pinnedAddress.address, pinnedAddress.family);
                },
            },
            (response) => {
                const status = response.statusCode ?? 500;
                const body =
                    webRequest.method === "HEAD" ||
                    bodyForbiddenResponseStatuses.has(status)
                        ? null
                        : Readable.toWeb(response);
                resolve(
                    new Response(body as BodyInit | null, {
                        headers: toResponseHeaders(response.headers),
                        status,
                        statusText: response.statusMessage,
                    }),
                );
            },
        );
        nodeRequest.once("error", reject);
        nodeRequest.end();
    });
};

/**
 * Some first-party MCP clients publish every grant they can use across OAuth
 * providers. VS Code includes Device Authorization and Claude includes the JWT
 * bearer grant alongside authorization-code and refresh-token grants. SendLit
 * does not implement those optional grants; both clients use Authorization
 * Code + PKCE for this MCP connection.
 *
 * Keep the exceptions exact and deterministic: only each client's canonical
 * metadata URL has its known unsupported declaration removed before
 * registration. Every other CIMD document receives strict provider validation.
 */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = async (
    input,
    init,
) => {
    const response = await fetchPinnedClientMetadataResource(input, init);
    const requestUrl = input instanceof Request ? input.url : String(input);
    const ignoredGrantTypes = ignoredGrantTypesByClientMetadataUrl.get(
        new URL(requestUrl).href,
    );
    if (!ignoredGrantTypes) return response;
    if (response.status !== 200) return response;

    const metadata = (await response.json()) as {
        grant_types?: unknown;
        [key: string]: unknown;
    };
    if (!Array.isArray(metadata.grant_types)) return response;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(
        JSON.stringify({
            ...metadata,
            grant_types: metadata.grant_types.filter(
                (grantType) =>
                    typeof grantType !== "string" ||
                    !ignoredGrantTypes.has(grantType),
            ),
        }),
        {
            headers,
            status: response.status,
            statusText: response.statusText,
        },
    );
};
