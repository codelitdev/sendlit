import { afterEach, describe, expect, it, mock } from "bun:test";
import { registerDom } from "@sendlit/test-utils/dom";

registerDom();

const mocks = {
  initPosthogBrowser: mock().mockResolvedValue(null),
  identifyPosthogUserFromSession: mock().mockResolvedValue(undefined),
};

mock.module("@/lib/posthog-browser", () => ({
  initPosthogBrowser: mocks.initPosthogBrowser,
  identifyPosthogUserFromSession: mocks.identifyPosthogUserFromSession,
}));

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { PostHogProvider } = await import("./posthog-provider");

describe("PostHogProvider", () => {
  afterEach(() => {
    cleanup();
    mocks.initPosthogBrowser.mockReset();
    mocks.identifyPosthogUserFromSession.mockReset();
    mocks.initPosthogBrowser.mockResolvedValue(null);
    mocks.identifyPosthogUserFromSession.mockResolvedValue(undefined);
  });

  it("initializes and identifies when a key is provided", async () => {
    render(
      <PostHogProvider
        apiKey="phc_test"
        host="https://eu.i.posthog.com"
        environment="production"
      >
        <div>child</div>
      </PostHogProvider>,
    );

    await waitFor(() => {
      expect(mocks.initPosthogBrowser).toHaveBeenCalledWith({
        apiKey: "phc_test",
        host: "https://eu.i.posthog.com",
        environment: "production",
      });
      expect(mocks.identifyPosthogUserFromSession).toHaveBeenCalled();
    });
  });
});
