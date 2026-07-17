import type express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

export type HttpTestResponse = {
    status: number;
    body: string;
    headers: Record<string, string | number | string[] | undefined>;
    json<T = any>(): T;
};

/** Drives an Express application without opening a TCP port. */
export async function requestApp(
    app: express.Express,
    path: string,
    init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Buffer;
    } = {},
): Promise<HttpTestResponse> {
    const body = init.body == null ? null : Buffer.from(init.body);
    const req = new IncomingMessage(new Socket());
    req.method = init.method ?? "GET";
    req.url = path;
    req.headers = {
        host: "localhost:5000",
        ...(body ? { "content-length": String(body.length) } : {}),
        ...init.headers,
    };

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const done = new Promise<HttpTestResponse>((resolve, reject) => {
        res.write = ((chunk: any, ...args: any[]) => {
            if (chunk) chunks.push(Buffer.from(chunk));
            args.find((arg) => typeof arg === "function")?.();
            return true;
        }) as typeof res.write;
        res.end = ((chunk: any, ...args: any[]) => {
            if (chunk) chunks.push(Buffer.from(chunk));
            args.find((arg) => typeof arg === "function")?.();
            const responseBody = Buffer.concat(chunks).toString("utf8");
            resolve({
                status: res.statusCode,
                body: responseBody,
                headers: res.getHeaders(),
                json: () => JSON.parse(responseBody),
            });
            return res;
        }) as typeof res.end;
        res.on("error", reject);
    });

    (app as any).handle(req, res);
    if (body) req.push(body);
    req.push(null);
    return done;
}
