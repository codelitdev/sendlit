import { vi } from "vitest";
import { SendLit, type SendLitOptions } from "./client";

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * A `SendLit` client wired to an in-memory fetch: queued replies are served
 * in order (the last one repeats) and every request is recorded.
 */
export function mockSendLit(
  replies: Reply | Reply[] = { status: 200, body: {} },
  options: SendLitOptions = {},
) {
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    const hasBody = reply.body !== undefined && reply.status !== 204;
    return new Response(hasBody ? JSON.stringify(reply.body) : null, {
      status: reply.status,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...reply.headers,
      },
    });
  });
  const sendlit = new SendLit({
    apiKey: "sl_live_test",
    endpoint: "https://api.test",
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...options,
  });
  return { sendlit, requests, fetch };
}
