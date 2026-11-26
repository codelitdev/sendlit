"use client";

import { Check, Globe, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
import { DialogSection } from "@/components/dashboard/dialog-section";
import { DnsRecordsTable } from "@/components/dashboard/dns-records-table";
import {
  STATUS_STYLE,
  type Status,
} from "@/components/dashboard/domain-authentication-dialog";
import { Loading } from "@/components/dashboard/loading";
import { Badge } from "@/components/ui/codelit/badge";
import { Button } from "@/components/ui/codelit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/codelit/dialog";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  getTeamSendingDomain,
  removeTeamSendingDomain,
  setTeamSendingDomain,
  type TeamSendingDomain,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Section = "From address" | "DKIM" | "DMARC";
const ERRORS: Record<string, string> = {
  esp_management_credentials_required:
    "This shared mailbox has no Amazon SES API key yet. Add one from Organizations → Delivery, then try again.",
  esp_management_credentials_invalid:
    "Amazon SES refused the mailbox's API key. Update it from Organizations → Delivery.",
  provider_domain_unsupported:
    "Teams can register their own domain only on an Amazon SES shared mailbox for now.",
  organization_delivery_disabled: "Grant this team a shared mailbox first.",
  domain_in_use:
    "This domain is already used by another team or by the shared mailbox itself.",
  domain_exists_at_provider:
    "This domain is already set up in the mailbox's Amazon SES account outside SendLit. Remove it there first, or use another domain.",
  domain_invalid: "Enter an address at a domain you own.",
  domain_public_suffix: "Use your own domain, not a shared one like gmail.com.",
  from_email_invalid: "Enter a valid email address.",
  esp_provider_error: "Amazon SES returned an error. Try again in a minute.",
};

function errorText(err: unknown): string {
  if (err instanceof ApiError) return ERRORS[err.message] ?? err.message;
  return "Something went wrong. Try again.";
}

/**
 * A team's own From domain on its shared mailbox (#220): register it, publish
 * the DKIM and DMARC records, and see when the team starts sending from it.
 */
export function TeamSendingDomainDialog({
  organizationId,
  team,
  onOpenChange,
  onChanged,
}: {
  organizationId: string;
  team: { teamId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [domain, setDomain] = useState<TeamSendingDomain | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState<"check" | "save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({
    "From address": true,
    DKIM: false,
    DMARC: false,
  });
  const [now, setNow] = useState(() => Date.now());

  function show(next: TeamSendingDomain | null) {
    setDomain(next);
    setNow(Date.now());
    setFromEmail(next?.fromEmail ?? "");
    setOpen({
      "From address": !next,
      DKIM: Boolean(next && next.dkim !== "verified"),
      DMARC: Boolean(next && next.dmarc !== "pass"),
    });
  }

  async function run(kind: "check" | "save" | "remove", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load again only when another team is opened
  useEffect(() => {
    setDomain(null);
    setLoaded(false);
    setError(null);
    if (!team) return;
    void run("check", async () => {
      show(await getTeamSendingDomain(organizationId, team.teamId));
    }).finally(() => setLoaded(true));
  }, [team?.teamId]);

  const passed = domain
    ? [domain.dkim === "verified", domain.dmarc === "pass"].filter(Boolean).length
    : 0;
  const summary = !domain
    ? "This team sends from the shared mailbox's domain."
    : domain.status === "failing"
      ? `Stopped authenticating. Broadcasts pause ${domain.graceEndsAt ? relativeTime(domain.graceEndsAt, now) : "soon"} unless it's fixed.`
      : domain.inUse
        ? `Mail from this team goes out as ${domain.fromEmail}.`
        : "Add the records below. The team switches to its own domain once both pass.";

  const [fromTone, fromBadge]: [Status, string] = !domain
    ? ["warn", "Not set"]
    : !domain.inUse
      ? [domain.status === "failing" ? "fail" : "warn", "Waiting for DNS"]
      : domain.status === "failing"
        ? ["fail", "Failing"]
        : ["pass", "In use"];

  const dkimRecords =
    domain?.records.filter((record) => record.purpose === "dkim") ?? [];
  const dmarcRecords =
    domain?.records.filter((record) => record.purpose === "dmarc") ?? [];

  return (
    <Dialog open={team !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            {domain ? (
              <>
                Sending domain <span className="font-mono">{domain.domain}</span>
              </>
            ) : (
              <>Sending domain for {team?.name}</>
            )}
          </DialogTitle>
          <DialogDescription>
            Inboxes judge mail by the domain that signs it. With its own domain, this
            team builds its own sender reputation instead of sharing the mailbox's.
          </DialogDescription>
          {domain && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
              <div className="flex gap-1" aria-hidden>
                {[domain.dkim === "verified", domain.dmarc === "pass"].map((ok, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed two-step progress bar
                    key={i}
                    className={cn(
                      "h-1.5 w-14 rounded-full",
                      ok ? STATUS_STYLE.pass.bar : STATUS_STYLE.warn.bar,
                    )}
                  />
                ))}
              </div>
              <span className="font-medium">{passed} of 2 done</span>
              <span className="text-muted-foreground">{summary}</span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!loaded && !error && <Loading />}
          {loaded && (
            <>
              <DialogSection
                name="From address"
                summary={
                  domain
                    ? (domain.fromEmail ?? domain.domain)
                    : "The address this team's emails come from."
                }
                summaryClassName="break-all"
                {...sectionStatus(fromTone, fromBadge)}
                open={open["From address"]}
                onOpenChange={(value) =>
                  setOpen((current) => ({ ...current, "From address": value }))
                }
              >
                <p className="text-sm">
                  {domain
                    ? "Change the address to use another domain; the old one is removed from the mailbox."
                    : "Enter the address this team should send from. Its domain is registered with the shared mailbox."}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="team-from-email">From address</Label>
                  <Input
                    id="team-from-email"
                    type="email"
                    value={fromEmail}
                    onChange={(event) => setFromEmail(event.target.value)}
                    placeholder="news@yourschool.org"
                    className="max-w-sm"
                  />
                </div>
                {domain && (
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      team &&
                      void run("remove", async () => {
                        await removeTeamSendingDomain(organizationId, team.teamId);
                        show(null);
                        onChanged?.();
                      })
                    }
                  >
                    {busy === "remove" ? "Removing…" : "Stop using this domain"}
                  </Button>
                )}
              </DialogSection>

              {domain && (
                <>
                  <DialogSection
                    name="DKIM"
                    summary="Signs every email so inboxes know it came from your domain."
                    {...(domain.dkim === "verified"
                      ? sectionStatus("pass", "Verified")
                      : domain.dkim === "failed"
                        ? sectionStatus("fail", "Failed")
                        : sectionStatus(
                            "warn",
                            `${dkimRecords.length} records to add`,
                          ))}
                    open={open.DKIM}
                    onOpenChange={(value) =>
                      setOpen((current) => ({ ...current, DKIM: value }))
                    }
                  >
                    <p className="text-sm">
                      Add these CNAME records at your DNS provider. Amazon SES checks
                      them on its own, usually within an hour.
                    </p>
                    <DnsRecordsTable records={dkimRecords} domain={domain.domain} />
                  </DialogSection>
                  <DialogSection
                    name="DMARC"
                    summary="Tells inboxes what to do with mail that fails authentication."
                    {...(domain.dmarc === "pass"
                      ? sectionStatus("pass", "Set up")
                      : sectionStatus("warn", "1 record to add"))}
                    open={open.DMARC}
                    onOpenChange={(value) =>
                      setOpen((current) => ({ ...current, DMARC: value }))
                    }
                  >
                    <p className="text-sm">
                      Add this TXT record unless your domain already has a DMARC record.
                      Start with p=none to monitor.
                    </p>
                    <DnsRecordsTable records={dmarcRecords} domain={domain.domain} />
                  </DialogSection>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {domain?.lastCheckedAt
              ? `Checked ${relativeTime(domain.lastCheckedAt, now)}. DNS changes can take a few hours to show up.`
              : "DNS changes can take a few hours to show up."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!domain ||
            (fromEmail.trim() !== "" &&
              fromEmail.trim().toLowerCase() !== domain.fromEmail) ? (
              <Button
                disabled={!team || busy !== null || !fromEmail.includes("@")}
                onClick={() =>
                  team &&
                  void run("save", async () => {
                    show(
                      await setTeamSendingDomain(
                        organizationId,
                        team.teamId,
                        fromEmail,
                      ),
                    );
                    onChanged?.();
                  })
                }
              >
                <Globe className="size-4" />
                {busy === "save" ? "Registering…" : "Register domain"}
              </Button>
            ) : (
              <Button
                disabled={!team || busy !== null}
                onClick={() =>
                  team &&
                  void run("check", async () => {
                    show(await getTeamSendingDomain(organizationId, team.teamId));
                    onChanged?.();
                  })
                }
              >
                <RefreshCw
                  className={cn("size-4", busy === "check" && "animate-spin")}
                />
                {busy === "check" ? "Checking…" : "Check again"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Icon, icon colour and pill of a section in the given state. */
function sectionStatus(tone: Status, label: string) {
  return {
    icon: tone === "pass" ? <Check className="size-4" /> : "!",
    iconClassName: STATUS_STYLE[tone].icon,
    badge: <Badge variant={STATUS_STYLE[tone].badge}>{label}</Badge>,
  };
}
