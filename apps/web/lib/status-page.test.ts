import { afterEach, describe, expect, it } from "bun:test";
import { getStatusPageUrl } from "./config";

describe("getStatusPageUrl", () => {
  afterEach(() => {
    delete process.env.STATUS_PAGE_URL;
  });

  it("returns an http(s) URL, and nothing otherwise", () => {
    expect(getStatusPageUrl()).toBeNull();
    process.env.STATUS_PAGE_URL = " https://status.sendlit.app ";
    expect(getStatusPageUrl()).toBe("https://status.sendlit.app");
    process.env.STATUS_PAGE_URL = "javascript:alert(1)";
    expect(getStatusPageUrl()).toBeNull();
  });
});
