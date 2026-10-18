import { beforeEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal } from "@sendlit/test-utils";
import { resetAppModules } from "./test/reset-modules";

const mocks = {
  cookies: mock(),
  fetch: mock(),
};

mock.module("next/headers", () => ({
  cookies: mocks.cookies,
}));

stubGlobal("fetch", mocks.fetch);

describe("server session validation", () => {
  beforeEach(() => {
    resetAppModules();
    mocks.cookies.mockReset();
    mocks.fetch.mockReset();
  });

  it("does not call the auth endpoint when no cookies are present", async () => {
    mocks.cookies.mockResolvedValue({ toString: () => "" });

    const { hasServerSession } = await import("./server-session");

    await expect(hasServerSession()).resolves.toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("validates the session through the auth endpoint", async () => {
    mocks.cookies.mockResolvedValue({
      toString: () => "opaque_session_cookie=signed-session",
    });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ user: { email: "a@b.test" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { hasServerSession } = await import("./server-session");

    await expect(hasServerSession()).resolves.toBe(true);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/get-session",
      {
        headers: { Cookie: "opaque_session_cookie=signed-session" },
        cache: "no-store",
      },
    );
  });

  it("rejects invalid sessions from the auth endpoint", async () => {
    mocks.cookies.mockResolvedValue({
      toString: () => "opaque_session_cookie=signed-session",
    });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { hasServerSession } = await import("./server-session");

    await expect(hasServerSession()).resolves.toBe(false);
  });

  it("fails closed when the auth API is unreachable", async () => {
    mocks.cookies.mockResolvedValue({
      toString: () => "opaque_session_cookie=signed-session",
    });
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));

    const { hasServerSession } = await import("./server-session");

    await expect(hasServerSession()).resolves.toBe(false);
  });
});
