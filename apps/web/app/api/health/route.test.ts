import { describe, expect, it } from "bun:test";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers without sign-in and isn't cached", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", service: "sendlit-web" });
  });
});
