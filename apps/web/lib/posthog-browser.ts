import {
  type BrowserObservability,
  type BrowserPerson,
  createBrowserObservability,
} from "@codelitdev/observability/browser";

// Browser PostHog (identify and session recording) through
// @codelitdev/observability. Only initialized when the server passes a
// request-time POSTHOG_API_KEY (see components/posthog-provider.tsx).

const SERVICE = "sendlit:web";

let browser: BrowserObservability | null = null;
let initialized = false;

export function isPosthogBrowserInitialized() {
  return initialized;
}

export async function initPosthogBrowser(input: {
  apiKey: string;
  host: string;
  environment: string;
}) {
  if (!input.apiKey) return;
  browser ??= createBrowserObservability({
    serviceName: SERVICE,
    environment: input.environment,
    apiKey: input.apiKey,
    host: input.host,
  });
  await browser.init();
  initialized = true;
}

export function identifyPosthogUser(user: BrowserPerson | null | undefined) {
  browser?.identify(user);
}

export function resetPosthogUser() {
  browser?.reset();
}

export async function identifyPosthogUserFromSession() {
  if (!initialized) return;
  try {
    const response = await fetch("/api/auth/get-session", { cache: "no-store" });
    if (!response.ok) return;
    const session = (await response.json()) as { user?: BrowserPerson };
    identifyPosthogUser(session?.user);
  } catch {
    // Telemetry must not break the dashboard.
  }
}
