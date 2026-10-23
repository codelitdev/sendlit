"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/codelit/button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  connectGooglePostmaster,
  connectSnds,
  disconnectGooglePostmaster,
  disconnectSnds,
  getReputation,
  type Reputation,
  syncReputation,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const DOCS_URL = "https://docs.sendlit.app/email-marketing/reputation";

const pct = (value: number | null | undefined, digits = 2) =>
  value == null ? "–" : `${(value * 100).toFixed(digits)}%`;

const spamChart = {
  spamRate: { label: "Spam rate", color: "var(--primary)" },
} satisfies ChartConfig;

const FILTER_COLOR = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

const CONNECT_RESULT: Record<string, { variant: "success" | "error"; text: string }> = {
  google_connected: {
    variant: "success",
    text: "Google Postmaster Tools is connected. Data appears within a few minutes.",
  },
  google_cancelled: {
    variant: "error",
    text: "Google Postmaster Tools wasn't connected.",
  },
  google_failed: {
    variant: "error",
    text: "Connecting Google Postmaster Tools failed. Try again.",
  },
};

function since(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "not yet";
}

/** Mailbox provider reputation: Gmail via Postmaster Tools, Outlook via
 * SNDS, with a 30-day trend and current alerts. */
export function ReputationCard() {
  const [data, setData] = useState<Reputation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<(typeof CONNECT_RESULT)[string] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sndsUrl, setSndsUrl] = useState("");

  async function run(action: () => Promise<Reputation | undefined>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setData(result ?? (await getReputation()));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong";
      setError(
        message === "snds_link_invalid"
          ? "That isn't a working SNDS link. Copy it from SNDS's Automated Data Access page."
          : message === "too_many_requests"
            ? "Refreshed a moment ago. Try again in a few minutes."
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once; read the OAuth result from the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("reputation");
    if (result && CONNECT_RESULT[result]) {
      setNotice(CONNECT_RESULT[result]);
      params.delete("reputation");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    }
    void run(() => getReputation());
  }, []);

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Sender reputation</h2>
            <p className="text-sm text-muted-foreground">
              How Gmail and Outlook see your mail over the last 30 days.{" "}
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
                How to set this up
              </a>
            </p>
          </div>
          {(data?.google.connection || data?.snds.connection) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(syncReputation)}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          )}
        </div>

        {notice && <Banner variant={notice.variant}>{notice.text}</Banner>}
        {error && <Banner>{error}</Banner>}
        {data?.alerts.map((alert) => (
          <Banner
            key={`${alert.subject}-${alert.signal}`}
            variant={alert.level === "critical" ? "error" : "warning"}
          >
            {alert.message}
          </Banner>
        ))}

        {!data && !error && <Loading className="p-2" />}

        {data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Gmail · Google Postmaster Tools</h3>
              {!data.google.connection ? (
                <div className="space-y-2 rounded-md border border-dashed p-4 text-sm">
                  <p className="text-muted-foreground">
                    See the spam rate Gmail users report, SPF/DKIM/DMARC pass rates and
                    whether you meet Google&apos;s sender requirements. Verify your
                    sending domain in Postmaster Tools first, then connect the same
                    Google account.
                  </p>
                  {data.google.available ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          window.location.href = (
                            await connectGooglePostmaster()
                          ).authorizationUrl;
                          return undefined;
                        })
                      }
                    >
                      Connect Google Postmaster Tools
                    </Button>
                  ) : (
                    <p className="text-muted-foreground">
                      Not available on this SendLit: an administrator needs to set up a
                      Google OAuth client.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <ConnectionLine
                    connection={data.google.connection}
                    onDisconnect={() =>
                      run(async () => {
                        await disconnectGooglePostmaster();
                        return undefined;
                      })
                    }
                    busy={busy}
                  />
                  {data.google.domains.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Add a From address to an email service provider to see its domain
                      here.
                    </p>
                  )}
                  {data.google.domains.map((domain) => {
                    const latest = domain.days.at(-1);
                    return (
                      <div
                        key={domain.domain}
                        className="space-y-2 rounded-md border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{domain.domain}</span>
                          {domain.status === "not_in_postmaster" && (
                            <Badge variant="secondary">Not in Postmaster Tools</Badge>
                          )}
                          {domain.compliance?.status === "compliant" && (
                            <Badge variant="success">
                              Meets Google&apos;s requirements
                            </Badge>
                          )}
                          {domain.compliance?.status === "needs_work" && (
                            <Badge variant="destructive">Needs work</Badge>
                          )}
                        </div>
                        {domain.status === "not_in_postmaster" ? (
                          <p className="text-sm text-muted-foreground">
                            Add and verify this domain in Postmaster Tools with{" "}
                            {data.google.connection?.accountLabel ??
                              "the connected account"}
                            .
                          </p>
                        ) : domain.days.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No data yet. Google shows numbers once a domain sends enough
                            mail to Gmail each day.
                          </p>
                        ) : (
                          <>
                            <ChartContainer config={spamChart} className="h-32 w-full">
                              <LineChart
                                data={domain.days}
                                margin={{ left: 0, right: 8 }}
                              >
                                <CartesianGrid vertical={false} />
                                <XAxis
                                  dataKey="day"
                                  tickLine={false}
                                  axisLine={false}
                                  tickFormatter={(day: string) => day.slice(5)}
                                />
                                <YAxis
                                  width={44}
                                  tickLine={false}
                                  axisLine={false}
                                  domain={[0, (max: number) => Math.max(max, 0.004)]}
                                  tickFormatter={(value: number) => pct(value, 1)}
                                />
                                <ReferenceLine
                                  y={0.001}
                                  stroke="var(--color-amber-500, #f59e0b)"
                                  strokeDasharray="4 4"
                                />
                                <ReferenceLine
                                  y={0.003}
                                  stroke="var(--color-red-500, #ef4444)"
                                  strokeDasharray="4 4"
                                />
                                <ChartTooltip
                                  content={
                                    <ChartTooltipContent
                                      formatter={(value) => pct(Number(value))}
                                    />
                                  }
                                />
                                <Line
                                  dataKey="spamRate"
                                  type="monotone"
                                  stroke="var(--color-spamRate)"
                                  strokeWidth={2}
                                  dot={false}
                                  isAnimationActive={false}
                                  connectNulls
                                />
                              </LineChart>
                            </ChartContainer>
                            <dl className="grid grid-cols-4 gap-2 text-xs">
                              {(
                                [
                                  ["Spam", latest?.spamRate],
                                  ["SPF", latest?.spfRate],
                                  ["DKIM", latest?.dkimRate],
                                  ["DMARC", latest?.dmarcRate],
                                ] as const
                              ).map(([label, value]) => (
                                <div key={label}>
                                  <dt className="text-muted-foreground">{label}</dt>
                                  <dd className="font-medium">
                                    {pct(value, label === "Spam" ? 2 : 1)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Outlook · Microsoft SNDS</h3>
              {!data.snds.connection ? (
                <div className="space-y-2 rounded-md border border-dashed p-4 text-sm">
                  <p className="text-muted-foreground">
                    For dedicated IPs: see Outlook&apos;s spam filter verdict, complaint
                    rate and spam trap hits. Request access to your IPs in SNDS, then
                    paste the link from its Automated Data Access page.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="snds-url">SNDS data link</Label>
                    <div className="flex gap-2">
                      <Input
                        id="snds-url"
                        value={sndsUrl}
                        onChange={(event) => setSndsUrl(event.target.value)}
                        placeholder="https://substrate.office.com/…"
                      />
                      <Button
                        size="sm"
                        disabled={busy || !sndsUrl.trim()}
                        onClick={() => run(() => connectSnds(sndsUrl.trim()))}
                      >
                        Connect
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <ConnectionLine
                    connection={data.snds.connection}
                    onDisconnect={() =>
                      run(async () => {
                        await disconnectSnds();
                        return undefined;
                      })
                    }
                    busy={busy}
                  />
                  {data.snds.ips.length === 0 && (
                    <p className="text-sm text-muted-foreground">No IP data yet.</p>
                  )}
                  {data.snds.ips.map((ip) => {
                    const latest = ip.days.at(-1);
                    return (
                      <div key={ip.ip} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm">{ip.ip}</span>
                          <span className="text-xs text-muted-foreground">
                            Complaints {latest?.complaintRateText ?? "–"} · Trap hits{" "}
                            {latest?.trapHits ?? "–"}
                          </span>
                        </div>
                        <div
                          className="flex gap-0.5"
                          role="img"
                          aria-label={`Daily filter results for ${ip.ip}`}
                        >
                          {ip.days.map((day) => (
                            <span
                              key={day.day}
                              title={`${day.day}: ${day.filterResult ?? "no data"}`}
                              className={`h-4 flex-1 rounded-sm ${day.filterResult ? FILTER_COLOR[day.filterResult] : "bg-muted"}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionLine({
  connection,
  onDisconnect,
  busy,
}: {
  connection: NonNullable<Reputation["google"]["connection"]>;
  onDisconnect: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {connection.accountLabel ? `${connection.accountLabel} · ` : ""}Last updated{" "}
          {since(connection.lastSyncedAt)}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      {connection.status === "error" && connection.lastError && (
        <Banner variant="warning">{connection.lastError}</Banner>
      )}
    </div>
  );
}
