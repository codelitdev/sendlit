"use client";

import { Bot, ExternalLink, KeyRound, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { DialogSection } from "@/components/dashboard/dialog-section";
import { CopyButton } from "@/components/dashboard/domain-authentication-dialog";
import { MCP_DOCS_URL, useMcpUrl } from "@/components/dashboard/mcp-url";
import { Badge } from "@/components/ui/codelit/badge";
import { Card, CardContent } from "@/components/ui/codelit/card";

/** True when clients on the internet can't reach `url`, e.g. a local API. */
function isPrivateUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol !== "https:" ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^(127\.|10\.|192\.168\.)/.test(hostname)
    );
  } catch {
    return true;
  }
}

/** A value to paste somewhere: monospace, with a copy button. */
function CopyBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-5 whitespace-pre [scrollbar-width:thin]">
        {value}
      </pre>
      <CopyButton value={value} label={label} />
    </div>
  );
}

interface Client {
  id: string;
  name: string;
  summary: string;
  icon: ReactNode;
  body: (url: string, isPrivate: boolean) => ReactNode;
}

const CLIENTS: Client[] = [
  {
    id: "claude",
    name: "Claude",
    summary: "claude.ai, and the Claude desktop and mobile apps",
    icon: <Bot className="size-4" />,
    body: (url, isPrivate) => (
      <>
        <p className="text-sm">
          In Claude, open <strong>Settings → Connectors</strong>, choose{" "}
          <strong>Add custom connector</strong>, and paste the server URL. Claude opens
          SendLit&apos;s sign-in page the first time you use it.
        </p>
        <CopyBlock value={url} label="Copy the MCP server URL" />
        {isPrivate && (
          <Banner variant="warning">
            Claude connects from the internet, so it can&apos;t reach this server at a
            local or non-HTTPS address. Use Claude Code or another client on this
            machine instead.
          </Banner>
        )}
      </>
    ),
  },
  {
    id: "claude-code",
    name: "Claude Code",
    summary: "In your terminal",
    icon: <Terminal className="size-4" />,
    body: (url) => (
      <>
        <p className="text-sm">
          Run this, then run <code className="font-mono">/mcp</code> in Claude Code to
          sign in.
        </p>
        <CopyBlock
          value={`claude mcp add --transport http sendlit ${url}`}
          label="Copy the Claude Code command"
        />
      </>
    ),
  },
  {
    id: "cursor",
    name: "Cursor",
    summary: "Add it to your MCP settings",
    icon: <Terminal className="size-4" />,
    body: (url) => (
      <>
        <p className="text-sm">
          Add this to <code className="font-mono">~/.cursor/mcp.json</code> (or a
          project&apos;s <code className="font-mono">.cursor/mcp.json</code>), then sign
          in from Cursor&apos;s MCP settings.
        </p>
        <CopyBlock
          value={JSON.stringify({ mcpServers: { sendlit: { url } } }, null, 2)}
          label="Copy the Cursor configuration"
        />
      </>
    ),
  },
  {
    id: "vscode",
    name: "VS Code",
    summary: "GitHub Copilot agent mode",
    icon: <Terminal className="size-4" />,
    body: (url) => (
      <>
        <p className="text-sm">
          Add this to <code className="font-mono">.vscode/mcp.json</code> in your
          workspace, then start the server from that file and sign in.
        </p>
        <CopyBlock
          value={JSON.stringify(
            { servers: { sendlit: { type: "http", url } } },
            null,
            2,
          )}
          label="Copy the VS Code configuration"
        />
      </>
    ),
  },
  {
    id: "other",
    name: "Another assistant",
    summary: "Any client that supports remote MCP servers",
    icon: <KeyRound className="size-4" />,
    body: (url) => (
      <>
        <p className="text-sm">
          Add a remote MCP server (Streamable HTTP) with this URL. Clients that support
          OAuth sign you in; for one that doesn&apos;t, send a team API key in the{" "}
          <code className="font-mono">x-sendlit-apikey</code> header.
        </p>
        <CopyBlock value={url} label="Copy the MCP server URL" />
        <Link href="/settings?tab=api-keys" className="text-sm font-medium underline">
          Create an API key
        </Link>
      </>
    ),
  },
];

/**
 * Settings → AI assistants: how to connect an AI assistant to SendLit's MCP
 * server, so it can work on contacts, emails and reports for you.
 */
export function AiAssistantSettings() {
  const url = useMcpUrl();
  const [open, setOpen] = useState<Record<string, boolean>>({ claude: true });
  if (!url) return null;
  const isPrivate = isPrivateUrl(url);

  return (
    <div className="space-y-5">
      <div className="max-w-2xl space-y-1">
        <h2 className="font-medium">AI assistants</h2>
        <p className="text-sm text-muted-foreground">
          Connect Claude, Cursor, VS Code or another AI assistant to SendLit&apos;s MCP
          server. Then ask it to import contacts, write a sequence, or explain how your
          last broadcast did.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-medium">MCP server URL</p>
          <CopyBlock value={url} label="Copy the MCP server URL" />
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
            <span>
              Your assistant signs in as you and works in the team you pick. Its edits
              to running sequences and scheduled broadcasts are saved as drafts, so
              nothing contacts receive changes until it&apos;s published, and SendLit
              tells it to check with you first.
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {CLIENTS.map((client) => (
          <DialogSection
            key={client.id}
            open={open[client.id] ?? false}
            onOpenChange={(value) =>
              setOpen((current) => ({ ...current, [client.id]: value }))
            }
            icon={client.icon}
            iconClassName="bg-muted text-muted-foreground"
            name={client.name}
            summary={client.summary}
            badge={
              client.id === "claude" && isPrivate ? (
                <Badge variant="warning">Needs a public URL</Badge>
              ) : null
            }
          >
            {client.body(url, isPrivate)}
          </DialogSection>
        ))}
      </div>

      <a
        href={MCP_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium underline"
      >
        Tools, scopes and limits in the MCP docs
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
