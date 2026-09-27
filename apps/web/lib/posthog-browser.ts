type PosthogJs = (typeof import("posthog-js"))["default"];

const SERVICE = "sendlit:web";

let client: PosthogJs | null = null;
let initPromise: Promise<PosthogJs | null> | null = null;

export function isPosthogBrowserInitialized() {
    return Boolean(client);
}

export function initPosthogBrowser(input: {
    apiKey: string;
    host: string;
    environment: string;
}) {
    if (!input.apiKey) {
        return Promise.resolve(null);
    }

    if (client) {
        return Promise.resolve(client);
    }

    if (!initPromise) {
        initPromise = import("posthog-js").then(({ default: posthog }) => {
            if (client) {
                return client;
            }

            // Official Next.js defaults: SPA pageviews via history_change, and
            // session recording once it is enabled on the PostHog project.
            posthog.init(input.apiKey, {
                api_host: input.host,
                defaults: "2026-05-30",
                loaded(instance) {
                    instance.register({
                        service: SERVICE,
                        environment: input.environment,
                    });
                },
            });
            client = posthog;
            return posthog;
        });
    }

    return initPromise;
}

export function identifyPosthogUser(
    user:
        | {
              id?: string;
              email?: string;
              name?: string | null;
          }
        | null
        | undefined,
) {
    if (!client || !user?.id) {
        return;
    }

    client.identify(user.id, {
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
    });
}

export function resetPosthogUser() {
    client?.reset();
}

export async function identifyPosthogUserFromSession() {
    if (!client) {
        return;
    }

    try {
        const response = await fetch("/api/auth/get-session", {
            cache: "no-store",
        });
        if (!response.ok) {
            return;
        }

        const session = (await response.json()) as {
            user?: { id?: string; email?: string; name?: string | null };
        };
        identifyPosthogUser(session?.user);
    } catch {
        // Telemetry must not break the dashboard.
    }
}
