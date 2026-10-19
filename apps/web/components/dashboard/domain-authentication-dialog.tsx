"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  checkEspDomainAuthentication,
  type DomainAuthentication,
  type EspConfig,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

type Status = DomainAuthentication["spf"]["status"];

const STATUS: Record<
  Status,
  { label: string; variant: "success" | "secondary" | "destructive" }
> = {
  pass: { label: "Set up", variant: "success" },
  warn: { label: "Needs attention", variant: "secondary" },
  fail: { label: "Missing", variant: "destructive" },
};

/** SPF, DKIM and DMARC status of an ESP's sending domain, with the DNS
 * records to add. */
export function DomainAuthenticationDialog({
  esp,
  onOpenChange,
}: {
  esp: EspConfig | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = useState<DomainAuthentication | null>(null);
  const [selector, setSelector] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(espId: string, dkimSelector?: string) {
    setChecking(true);
    setError(null);
    try {
      setResult(await checkEspDomainAuthentication(espId, dkimSelector));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to check the domain");
    } finally {
      setChecking(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: check again only when another ESP is opened
  useEffect(() => {
    setResult(null);
    setSelector("");
    if (esp) void check(esp.espId);
  }, [esp]);

  const checks = result
    ? [
        { name: "SPF", check: result.spf },
        { name: "DKIM", check: result.dkim },
        { name: "DMARC", check: result.dmarc },
      ]
    : [];

  return (
    <Dialog open={esp !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Domain authentication{result ? `: ${result.domain}` : ""}
          </DialogTitle>
          <DialogDescription>
            SPF, DKIM and DMARC prove your email really comes from your domain. Gmail
            and Yahoo require all three from bulk senders, and mail without them is
            likely to land in spam.
          </DialogDescription>
        </DialogHeader>

        {error && <Banner>{error}</Banner>}
        {!result && !error && <Loading className="p-6" />}

        {result && (
          <div className="space-y-6">
            <div className="divide-y rounded-md border">
              {checks.map(({ name, check }) => (
                <div key={name} className="flex items-start gap-3 p-3">
                  <span className="w-14 font-medium">{name}</span>
                  <Badge variant={STATUS[check.status].variant}>
                    {STATUS[check.status].label}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p>{check.message}</p>
                    {check.record && (
                      <p
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={check.record}
                      >
                        {check.record}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">DNS records</h3>
              <p className="text-sm text-muted-foreground">
                Add these at your DNS provider. Values marked &quot;from your
                provider&quot; are unique to your account; copy them from{" "}
                {result.providerConsoleUrl ? (
                  <a
                    href={result.providerConsoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                  >
                    your provider&apos;s console
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  "your mail server's settings"
                )}
                . DNS changes can take up to a few hours to show up.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.records.map((record) => (
                    <TableRow key={`${record.type}-${record.name}-${record.purpose}`}>
                      <TableCell>{record.type}</TableCell>
                      <TableCell className="max-w-56">
                        <div className="truncate font-mono text-xs" title={record.name}>
                          {record.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {record.purpose}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-72">
                        {record.value ? (
                          <div className="flex items-center gap-1">
                            <span
                              className="truncate font-mono text-xs"
                              title={record.value}
                            >
                              {record.value}
                            </span>
                            <IconButton
                              title="Copy value"
                              aria-label={`Copy ${record.purpose} value`}
                              onClick={() =>
                                void navigator.clipboard.writeText(record.value ?? "")
                              }
                            >
                              <Copy className="size-3.5" />
                            </IconButton>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            From your provider
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.present ? (
                          <Badge variant="success">Found</Badge>
                        ) : (
                          <Badge variant="outline">Not found</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="dkim-selector">DKIM selector (optional)</Label>
                <Input
                  id="dkim-selector"
                  value={selector}
                  onChange={(event) => setSelector(event.target.value)}
                  placeholder={result.dkim.selector ?? "e.g. selector1"}
                  className="w-56"
                />
              </div>
              <p className="pb-2 text-xs text-muted-foreground">
                If your provider uses its own selector, enter it to check that key.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!esp || checking}
            onClick={() => esp && void check(esp.espId, selector.trim() || undefined)}
          >
            {checking ? "Checking…" : "Check again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
