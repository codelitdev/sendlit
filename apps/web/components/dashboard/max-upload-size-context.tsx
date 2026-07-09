"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_MAX_UPLOAD_SIZE_BYTES } from "@/lib/media-limits";

const MaxUploadSizeContext = createContext<number>(
    DEFAULT_MAX_UPLOAD_SIZE_BYTES,
);

/**
 * Threads the server-read `MAX_UPLOAD_SIZE` env var down to client
 * components. Values are read fresh per request by the Server Component
 * ancestor (see `app/editor/layout.tsx`), so — unlike `NEXT_PUBLIC_*` env
 * vars or `next.config.js`'s `env` field, both of which get frozen into the
 * client bundle at `next build` time — this can be changed at
 * deploy/container-start time without rebuilding the app.
 */
export function MaxUploadSizeProvider({
    value,
    children,
}: {
    value: number;
    children: ReactNode;
}) {
    return (
        <MaxUploadSizeContext.Provider value={value}>
            {children}
        </MaxUploadSizeContext.Provider>
    );
}

export function useMaxUploadSizeBytes() {
    return useContext(MaxUploadSizeContext);
}
