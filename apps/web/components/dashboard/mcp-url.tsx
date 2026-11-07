"use client";

import { createContext, type ReactNode, useContext } from "react";

const McpUrlContext = createContext<string | null>(null);

/** Hands the MCP server URL, a server-only setting (`getMcpUrl`), to client
 * components, so it can change at container start without a rebuild. */
export function McpUrlProvider({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return <McpUrlContext.Provider value={url}>{children}</McpUrlContext.Provider>;
}

/** The MCP server URL, or null outside an `McpUrlProvider`. */
export function useMcpUrl(): string | null {
  return useContext(McpUrlContext);
}

/** Where the dashboard explains connecting an AI assistant. */
export const AI_ASSISTANTS_SETTINGS_HREF = "/settings?tab=ai";
export const MCP_DOCS_URL = "https://docs.sendlit.app/developers/mcp";
