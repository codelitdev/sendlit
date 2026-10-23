"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/dashboard/domain-authentication-dialog";
import { Loading } from "@/components/dashboard/loading";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/codelit/badge";
import { Button } from "@/components/ui/codelit/button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  getTrackingDomain,
  setTrackingDomain,
  type TrackingDomain,
  verifyTrackingDomain,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ERRORS: Record<string, string> = {
  tracking_domain_invalid:
    "Enter a subdomain you own, such as track.example.com. A root domain can't have a CNAME record.",
  tracking_domain_taken: "Another workspace already uses this domain.",
};

const CHECK_ERRORS: Record<string, string> = {
  cname_missing: "We can't find a CNAME record for this domain yet.",
  cname_mismatch: "The CNAME record points somewhere else.",
  unreachable:
    "The CNAME is right, but SendLit doesn't answer over HTTPS on this domain yet. The certificate is usually ready a few minutes after DNS updates.",
  dns_error: "We couldn't look up this domain. Try again in a minute.",
};

const STATUS: Record<
  NonNullable<TrackingDomain["status"]>,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  verified: { label: "Verified", variant: "success" },
  pending: { label: "Waiting for DNS", variant: "warning" },
  failed: { label: "Not working", variant: "destructive" },
};

/** The team's custom domain for open, click, unsubscribe and "view in
 * browser" links. */
export function TrackingDomainSettings() {
  const [current, setCurrent] = useState<TrackingDomain | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<"save" | "verify" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(value: TrackingDomain) {
    setCurrent(value);
    setDomain(value.domain ?? "");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    getTrackingDomain()
      .then(apply)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load"),
      );
  }, []);

  async function run(action: "save" | "verify" | "remove") {
    setBusy(action);
    setError(null);
    try {
      const next =
        action === "verify"
          ? await verifyTrackingDomain()
          : await setTrackingDomain(action === "remove" ? null : domain.trim());
      apply(next);
      // A new domain is checked straight away, so a ready one verifies at once.
      if (action === "save" && next.domain) apply(await verifyTrackingDomain());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong";
      setError(ERRORS[message] ?? message);
    } finally {
      setBusy(null);
    }
  }

  if (!current && !error) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10">
          <Loading />
        </CardContent>
      </Card>
    );
  }

  const status = current?.status ? STATUS[current.status] : null;
  const changed = domain.trim().toLowerCase() !== (current?.domain ?? "");

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Tracking domain</CardTitle>
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Open, click, unsubscribe and "view in browser" links use SendLit's domain by
          default. Use your own subdomain so links match your brand and don't share
          reputation with other senders.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tracking-domain">Domain</Label>
          <Input
            id="tracking-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="track.example.com"
            className="font-mono"
          />
        </div>

        {current?.domain && current.status !== "verified" && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">
              Add this CNAME record at your DNS provider. If you use Cloudflare, set it
              to "DNS only" (grey cloud).
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-[5rem_1fr]">
              <span className="text-muted-foreground">Type</span>
              <span className="font-mono text-xs leading-5">CNAME</span>
              <span className="text-muted-foreground">Name</span>
              <span className="flex items-start gap-1.5">
                <span className="break-all font-mono text-xs leading-5">
                  {current.domain}
                </span>
                <CopyButton value={current.domain} label="Copy CNAME name" />
              </span>
              <span className="text-muted-foreground">Value</span>
              <span className="flex items-start gap-1.5">
                <span className="break-all font-mono text-xs leading-5">
                  {current.cnameTarget}
                </span>
                <CopyButton value={current.cnameTarget} label="Copy CNAME value" />
              </span>
            </div>
            {current.error && (
              <p className="text-sm text-[var(--warning)]">
                {CHECK_ERRORS[current.error] ?? current.error}
              </p>
            )}
          </div>
        )}

        {current?.status === "verified" && (
          <p className="text-sm text-muted-foreground">
            New emails use <span className="font-mono">{current.domain}</span>. Keep the
            CNAME record in place: links in emails you've sent depend on it.
          </p>
        )}
        {current?.status === "failed" && (
          <p className="text-sm text-destructive">
            This domain stopped working, so new emails use SendLit's domain again.{" "}
            {current.error ? CHECK_ERRORS[current.error] : null}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
        <span className="text-sm text-muted-foreground">
          {current?.checkedAt
            ? `Last checked ${new Date(current.checkedAt).toLocaleString()}. We recheck automatically.`
            : "DNS changes can take a few minutes to an hour."}
        </span>
        <div className="flex gap-2">
          {current?.domain && (
            <Button
              variant="outline"
              onClick={() => run("remove")}
              disabled={busy !== null}
            >
              Remove
            </Button>
          )}
          {current?.domain && !changed && current.status !== "verified" ? (
            <Button onClick={() => run("verify")} disabled={busy !== null}>
              <RefreshCw className={busy === "verify" ? "animate-spin" : undefined} />
              {busy === "verify" ? "Checking…" : "Check now"}
            </Button>
          ) : (
            <Button
              onClick={() => run("save")}
              disabled={busy !== null || !changed || !domain.trim()}
            >
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
