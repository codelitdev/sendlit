import {
    convertQueryParamsToUrlString,
    insertParamsIntoPath,
    type AppRoute,
    type ClientInferRequest,
    type ClientInferResponseBody,
} from "@ts-rest/core";
import { SendLitError } from "./errors";

type SuccessStatus = 200 | 201 | 202 | 204;

/** The success-response body of a contract route. */
export type Ok<R extends AppRoute> = ClientInferResponseBody<
    R,
    Extract<keyof R["responses"], SuccessStatus>
>;

type RequestOf<R extends AppRoute> = ClientInferRequest<R>;
/** The request body / query of a contract route (Zod input types). */
export type Body<R extends AppRoute> =
    RequestOf<R> extends { body: infer B } ? B : never;
export type Query<R extends AppRoute> =
    RequestOf<R> extends { query: infer Q } ? Q : never;

export interface RequestArgs {
    params?: Record<string, string>;
    query?: unknown;
    body?: unknown;
    /** Safe to retry on 5xx / network errors even though the method isn't
     * idempotent (find-or-create endpoints, sends with an idempotency key). */
    retrySafe?: boolean;
}

export interface HttpClientConfig {
    endpoint: string;
    headers: Record<string, string>;
    maxRetries: number;
    timeout: number;
    fetch: typeof fetch;
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);
const MAX_RETRY_DELAY_MS = 30_000;

export class HttpClient {
    constructor(private readonly config: HttpClientConfig) {}

    /**
     * Calls a route of `@sendlit/api-contract` — method, path and types all
     * come from the contract, so the SDK can't drift from the server.
     */
    async request<R extends AppRoute>(
        route: R,
        args: RequestArgs = {},
    ): Promise<Ok<R>> {
        const url =
            this.config.endpoint +
            insertParamsIntoPath({
                path: route.path,
                params: (args.params ?? {}) as never,
            }) +
            convertQueryParamsToUrlString(args.query ?? {}, false);
        const headers: Record<string, string> = {
            accept: "application/json",
            ...this.config.headers,
        };
        let payload: string | undefined;
        if (route.method !== "GET" && args.body !== undefined) {
            headers["content-type"] = "application/json";
            payload = JSON.stringify(args.body);
        }
        const retryServerErrors =
            args.retrySafe || IDEMPOTENT_METHODS.has(route.method);

        for (let attempt = 0; ; attempt++) {
            const canRetry = attempt < this.config.maxRetries;
            let response: Response;
            try {
                response = await this.send(url, route.method, headers, payload);
            } catch (error) {
                if (canRetry && retryServerErrors) {
                    await sleep(backoff(attempt));
                    continue;
                }
                throw error;
            }

            const body = await readBody(response);
            if (response.ok) return body as Ok<R>;

            // A 429 means the request was rejected before any work was done,
            // so it's safe to retry regardless of method.
            const retryable =
                response.status === 429 ||
                (response.status >= 500 && retryServerErrors);
            if (canRetry && retryable) {
                await sleep(retryAfter(response.headers) ?? backoff(attempt));
                continue;
            }
            throw SendLitError.fromResponse(
                response.status,
                body,
                response.headers,
            );
        }
    }

    private async send(
        url: string,
        method: string,
        headers: Record<string, string>,
        body: string | undefined,
    ): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeout);
        try {
            return await this.config.fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal,
            });
        } catch (error) {
            const timedOut = controller.signal.aborted;
            throw new SendLitError({
                status: 0,
                code: timedOut ? "timeout" : "connection_error",
                message: timedOut
                    ? `Request timed out after ${this.config.timeout}ms`
                    : `Could not reach SendLit at ${this.config.endpoint}`,
                cause: error,
            });
        } finally {
            clearTimeout(timer);
        }
    }
}

async function readBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    if (response.headers.get("content-type")?.includes("json")) {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    return text;
}

/** Exponential backoff with jitter: ~0.5s, 1s, 2s … capped. */
function backoff(attempt: number): number {
    const base = Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
    return base * (0.75 + Math.random() * 0.25);
}

function retryAfter(headers: Headers): number | undefined {
    const value = headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(value) - Date.now();
    return Number.isFinite(ms)
        ? Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS)
        : undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walks a page-numbered (`offset` = 1-based page) list endpoint, yielding
 * every item until the reported `total` is reached or a page comes back
 * empty.
 */
export async function* paginate<T>(
    fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): AsyncGenerator<T, void, undefined> {
    let seen = 0;
    for (let page = 1; ; page++) {
        const { items, total } = await fetchPage(page);
        for (const item of items) yield item;
        seen += items.length;
        if (items.length === 0 || seen >= total) return;
    }
}
