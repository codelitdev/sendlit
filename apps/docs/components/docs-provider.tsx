"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export function DocsProvider({ children }: { children: ReactNode }) {
    return <RootProvider search={{ enabled: false }}>{children}</RootProvider>;
}
