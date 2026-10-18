import { afterAll, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import express from "express";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb(), pool: { end: vi.fn() } };
});

const mocks = {
  verifyBearerToken: vi.fn(),
};

mock.module("./better-auth", () => ({
  SESSION_COOKIE_NAME: "sendlit.session_token",
  auth: {
    api: {
      getSession: vi.fn(async () => null),
    },
  },
  authIssuer: "https://sendlit.test/api/auth",
  mcpProtectedResourceMetadataUrl:
    "https://sendlit.test/.well-known/oauth-protected-resource/mcp",
  mcpResourceUrl: "https://sendlit.test/mcp",
  validOAuthAudiences: ["https://sendlit.test", "https://sendlit.test/mcp"],
  oauthResourceClient: {
    getActions: () => ({ verifyBearerToken: mocks.verifyBearerToken }),
  },
}));

mock.module("better-auth/node", () => ({
  fromNodeHeaders: vi.fn((headers) => headers),
}));

const { default: contactsRoutes } = await import("../contacts/routes");
const { db } = await import("../db/client");
const { seedTeamAndContact, truncateAll } = await import("../test/db");
type TestDb = import("../test/db").TestDb;

const tdb = db as unknown as TestDb;

async function request(router: express.Router, path: string, init?: RequestInit) {
  const bodyChunks: Buffer[] = [];
  const headers = new Map<string, string | number | readonly string[]>();

  const req = Object.create(express.request) as any;
  req.method = init?.method ?? "GET";
  req.url = path;
  req.originalUrl = path;
  req.query = {};
  req.headers = Object.fromEntries(new Headers(init?.headers).entries()) as Record<
    string,
    string
  >;
  req.app = { get: () => undefined };

  const res = Object.create(express.response) as any;
  req.res = res;
  res.req = req;
  res.app = req.app;
  res.statusCode = 200;
  res.setHeader = (name: string, value: string | number | readonly string[]) =>
    headers.set(name.toLowerCase(), value);
  res.getHeader = (name: string) => headers.get(name.toLowerCase());
  res.getHeaders = () => Object.fromEntries(headers.entries());
  res.removeHeader = (name: string) => headers.delete(name.toLowerCase());
  res.writeHead = (statusCode: number, responseHeaders?: Record<string, string>) => {
    res.statusCode = statusCode;
    for (const [name, value] of Object.entries(responseHeaders ?? {})) {
      res.setHeader(name, value);
    }
    return res;
  };
  res.end = (
    chunk?: string | Buffer,
    _encoding?: BufferEncoding,
    callback?: () => void,
  ) => {
    if (chunk) bodyChunks.push(Buffer.from(chunk));
    callback?.();
    resolveResponse();
    return res;
  };

  let resolveResponse!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveResponse = resolve;
  });

  (router as any).handle(req, res, (error: unknown) => {
    if (error) throw error;
    resolveResponse();
  });
  await finished;

  return {
    status: res.statusCode as number,
    async json() {
      return JSON.parse(Buffer.concat(bodyChunks).toString("utf8"));
    },
  };
}

describe("REST bearer token authentication", () => {
  beforeEach(async () => {
    await truncateAll(tdb);
    mocks.verifyBearerToken.mockReset();
  });

  afterAll(async () => {
    await tdb.$client.close();
  });

  it("accepts a Better Auth OAuth access token on REST routes", async () => {
    const { account, contact } = await seedTeamAndContact(tdb, {
      account: { email: "owner@example.com" },
      contact: { email: "reader@example.com" },
    });
    mocks.verifyBearerToken.mockResolvedValueOnce({
      iss: "https://sendlit.test/api/auth",
      sub: account.id,
      azp: "sendlit-local-token",
      scope: "contacts:read",
      aud: "https://sendlit.test",
    });

    const response = await request(contactsRoutes, "/contacts", {
      headers: { authorization: "Bearer valid-oauth-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      items: [
        {
          contactId: contact.contactId,
          email: "reader@example.com",
        },
      ],
    });
    expect(mocks.verifyBearerToken).toHaveBeenCalledWith(
      "valid-oauth-token",
      expect.objectContaining({
        verifyOptions: expect.objectContaining({
          issuer: "https://sendlit.test/api/auth",
        }),
      }),
    );
  });
});
