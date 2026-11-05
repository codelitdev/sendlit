"use client";

import { ArrowRight, Bot, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AI_ASSISTANTS_SETTINGS_HREF, useMcpUrl } from "@/components/dashboard/mcp-url";
import { Button } from "@/components/ui/codelit/button";
import { Card, CardContent } from "@/components/ui/codelit/card";
import { IconButton } from "@/components/ui/codelit/icon-button";

const DISMISSED_KEY = "sendlit:ai-assistant-promo-dismissed";

/**
 * Overview card that introduces the MCP server: what an assistant can do,
 * and a link to set one up. Dismissed per browser.
 */
export function AiAssistantPromoCard() {
  const url = useMcpUrl();
  // Hidden until we know it wasn't dismissed, so it never flashes.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(localStorage.getItem(DISMISSED_KEY) === null);
  }, []);

  if (!url || !visible) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-primary">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-semibold">Use SendLit from your AI assistant</h2>
          <p className="text-sm text-muted-foreground">
            Connect Claude, Cursor or VS Code and ask, for example, &ldquo;Draft a
            three-email welcome sequence for new signups&rdquo; or &ldquo;How did last
            week&apos;s broadcast do?&rdquo;
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={AI_ASSISTANTS_SETTINGS_HREF}>
              Connect an assistant
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <IconButton
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
              setVisible(false);
            }}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </CardContent>
    </Card>
  );
}

/** One quiet line for an empty list whose items an assistant can create
 * over MCP: "or have your AI assistant …". */
export function AiAssistantHint({ action = "draft one" }: { action?: string }) {
  if (!useMcpUrl()) return null;
  return (
    <p className="text-sm text-muted-foreground">
      or{" "}
      <Link
        href={AI_ASSISTANTS_SETTINGS_HREF}
        className="font-medium text-foreground underline underline-offset-4"
      >
        have your AI assistant {action}
      </Link>
    </p>
  );
}
