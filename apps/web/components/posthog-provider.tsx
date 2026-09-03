"use client";

import { useEffect, type ReactNode } from "react";
import {
    identifyPosthogUserFromSession,
    initPosthogBrowser,
} from "@/lib/posthog-browser";

/**
 * Initializes PostHog in the browser. Only mounted when `POSTHOG_API_KEY` is
 * set, matching the API's optional client.
 */
export function PostHogProvider({
    apiKey,
    host,
    environment,
    children,
}: {
    apiKey: string;
    host: string;
    environment: string;
    children: ReactNode;
}) {
    useEffect(() => {
        void initPosthogBrowser({ apiKey, host, environment }).then(() =>
            identifyPosthogUserFromSession(),
        );
    }, [apiKey, host, environment]);

    return children;
}
