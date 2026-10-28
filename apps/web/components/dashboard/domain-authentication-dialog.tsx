"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
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
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { espProviderLabel } from "@/lib/esp-providers";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Status = DomainAuthentication["spf"]["status"];
type DnsRecord = DomainAuthentication["records"][number];
type Section = "SPF" | "DKIM" | "DMARC";
/** What every check (SPF, DKIM, DMARC) has in common. */
type CheckSummary = { status: Status; message: string };

const SECTION_SUMMARY: Record<
  Section,
  (domain: string, result: DomainAuthentication) => string
> = {
  // With a separate bounce (Return-Path) domain, its SPF is what DMARC checks.
  SPF: (domain, result) =>
    result.spf.host !== domain
      ? `Lists the servers allowed to send for your bounce (Return-Path) domain, ${result.spf.host}.`
      : `Lists the servers allowed to send as ${domain}.`,
  DKIM: () => "Signs every email so inboxes know nobody changed it.",
  DMARC: () => "Tells inboxes what to do with mail that fails SPF or DKIM.",
};

const STATUS_STYLE: Record<
  Status,
  { icon: string; bar: string; badge: "success" | "warning" | "destructive" }
> = {
  pass: {
    icon: "bg-[var(--success-soft)] text-[#1f6b35]",
    bar: "bg-[var(--success)]",
    badge: "success",
  },
  warn: {
    icon: "bg-[var(--warning-soft)] text-[var(--warning)]",
    bar: "bg-[var(--warning)]",
    badge: "warning",
  },
  fail: {
    icon: "bg-[var(--destructive-soft)] text-destructive",
    bar: "bg-destructive",
    badge: "destructive",
  },
};

/** The selector part of what was typed: SES and others show the whole record
 * name (`<token>._domainkey.example.com`), so accept that too. */
function selectorOf(input: string): string | undefined {
  return (
    input
      .trim()
      .split(/\._domainkey/i)[0]
      ?.trim() || undefined
  );
}

function sectionOf(record: DnsRecord): Section {
  if (record.purpose === "DMARC") return "DMARC";
  if (record.purpose.startsWith("DKIM")) return "DKIM";
  return "SPF";
}

function list(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** SPF, DKIM and DMARC status of an ESP's sending domain, one expandable
 * section each, with the DNS records still to add. */
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
  const [open, setOpen] = useState<Record<Section, boolean>>({
    SPF: false,
    DKIM: false,
    DMARC: false,
  });
  const [now, setNow] = useState(() => Date.now());

  async function check(espId: string, dkimSelector?: string) {
    setChecking(true);
    setError(null);
    try {
      const checked = await checkEspDomainAuthentication(espId, dkimSelector);
      setResult(checked);
      setNow(Date.now());
      // Open what still needs work; leave the rest folded.
      setOpen({
        SPF: checked.spf.status !== "pass",
        DKIM: checked.dkim.status !== "pass",
        DMARC: checked.dmarc.status !== "pass",
      });
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

  // Keep "Checked … ago" current while the dialog is open.
  useEffect(() => {
    if (!result) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [result]);

  const domain = result?.domain ?? esp?.fromEmail?.split("@")[1] ?? "your domain";
  const provider = result ? espProviderLabel(result.provider) : "";
  const sections: Array<{ name: Section; check: CheckSummary }> = result
    ? [
        { name: "SPF", check: result.spf },
        { name: "DKIM", check: result.dkim },
        { name: "DMARC", check: result.dmarc },
      ]
    : [];
  const done = sections.filter((section) => section.check.status === "pass");
  const left = sections.filter((section) => section.check.status !== "pass");

  return (
    <Dialog open={esp !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            Authenticate <span className="font-mono">{domain}</span>
          </DialogTitle>
          <DialogDescription>
            Gmail and Yahoo expect SPF, DKIM and DMARC from anyone sending in bulk. Set
            up all three and your campaigns land in the inbox, not spam.
          </DialogDescription>
          {result && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
              <div className="flex gap-1" aria-hidden>
                {sections.map((section) => (
                  <span
                    key={section.name}
                    className={cn(
                      "h-1.5 w-14 rounded-full",
                      STATUS_STYLE[section.check.status].bar,
                    )}
                  />
                ))}
              </div>
              <span className="font-medium">{done.length} of 3 done</span>
              <span className="text-muted-foreground">
                {left.length === 0
                  ? "Your domain is fully authenticated"
                  : `${list(left.map((section) => section.name))} ${left.length === 1 ? "is" : "are"} left`}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {error && <Banner>{error}</Banner>}
          {!result && !error && <Loading />}
          {result &&
            sections.map(({ name, check }) => (
              <AuthSection
                key={name}
                name={name}
                check={check}
                domain={domain}
                provider={provider}
                result={result}
                open={open[name]}
                onOpenChange={(value) =>
                  setOpen((current) => ({ ...current, [name]: value }))
                }
                selector={selector}
                onSelectorChange={setSelector}
              />
            ))}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {result
              ? `Checked ${relativeTime(result.checkedAt, now)}. DNS changes can take a few hours to show up.`
              : "DNS changes can take a few hours to show up."}
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              disabled={!esp || checking}
              onClick={() => esp && void check(esp.espId, selectorOf(selector))}
            >
              <RefreshCw className={cn("size-4", checking && "animate-spin")} />
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthSection({
  name,
  check,
  domain,
  provider,
  result,
  open,
  onOpenChange,
  selector,
  onSelectorChange,
}: {
  name: Section;
  check: CheckSummary;
  domain: string;
  provider: string;
  result: DomainAuthentication;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selector: string;
  onSelectorChange: (value: string) => void;
}) {
  const records = result.records.filter((record) => sectionOf(record) === name);
  const missing = records.filter((record) => !record.present).length;
  const isSes = result.provider === "ses";
  const policy = name === "DMARC" ? result.dmarc.policy : null;
  const badge =
    check.status === "pass"
      ? policy === "none"
        ? "Monitoring"
        : policy
          ? "Enforced"
          : "Set up"
      : missing > 0
        ? `${missing} record${missing === 1 ? "" : "s"} to add`
        : check.status === "warn"
          ? "Needs attention"
          : "Missing";

  const instruction =
    check.status === "pass"
      ? check.message
      : name === "SPF"
        ? records.some((record) => record.name !== domain)
          ? `${provider} sends bounces from ${records[0]?.name}. Add ${records.length === 1 ? "this record" : "these records"} at your DNS provider so SPF lines up with ${domain}.`
          : `Add this SPF record at your DNS provider. A domain can have only one SPF record, so merge it into any you already have.`
        : name === "DKIM"
          ? isSes
            ? `Amazon SES gives you three CNAME records for ${domain}. Copy each one from SES and add it at your DNS provider.`
            : records.length > 0
              ? `Copy the DKIM ${records.length === 1 ? "record" : "records"} from ${provider} and add ${records.length === 1 ? "it" : "them"} at your DNS provider.`
              : "Publish your mail server's DKIM key as a TXT record, then enter its selector below to check it."
          : "Add this record so inboxes know what to do with mail that fails SPF or DKIM. Start with p=none to monitor.";

  let dkimKey = 0;
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-4 rounded-lg px-5 py-4 text-left outline-none focus-visible:shadow-[var(--shadow-focus)]">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
            STATUS_STYLE[check.status].icon,
          )}
          aria-hidden
        >
          {check.status === "pass" ? <Check className="size-4" /> : "!"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-sm text-muted-foreground">
            {SECTION_SUMMARY[name](domain, result)}
          </span>
        </span>
        <Badge variant={STATUS_STYLE[check.status].badge}>{badge}</Badge>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 px-5 pb-5 sm:pl-[4.75rem]">
        <p className="text-sm">{instruction}</p>
        {/* The check's own message only when the records table doesn't already
            explain it, e.g. two SPF records or a record found with the wrong value. */}
        {check.status !== "pass" && (records.length === 0 || missing === 0) && (
          <p className="text-sm text-muted-foreground">{check.message}</p>
        )}

        {records.length > 0 && (
          <div className="overflow-hidden rounded-lg border bg-muted/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Type</TableHead>
                  <TableHead className="px-4">Host</TableHead>
                  <TableHead className="px-4">Value</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const isToken = record.name.startsWith("<token");
                  if (isToken) dkimKey += 1;
                  return (
                    <TableRow
                      key={`${record.type}-${record.name}-${record.purpose}`}
                      className="align-top hover:bg-transparent"
                    >
                      <TableCell className="whitespace-normal px-4 py-3">
                        <span className="rounded-md border bg-card px-2 py-1 font-mono text-xs">
                          {record.type}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          <span className="break-all font-mono text-xs leading-5">
                            {record.name}
                          </span>
                          <CopyButton
                            value={record.name}
                            label={`Copy ${record.purpose} host`}
                          />
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {isToken
                            ? `DKIM key ${dkimKey} of ${records.length}`
                            : record.purpose}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal px-4 py-3">
                        {record.value ? (
                          <div className="flex items-start gap-1.5">
                            <span className="break-all font-mono text-xs leading-5">
                              {record.value}
                            </span>
                            <CopyButton
                              value={record.value}
                              label={`Copy ${record.purpose} value`}
                            />
                          </div>
                        ) : result.providerConsoleUrl ? (
                          <a
                            href={result.providerConsoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            Copy from {provider}
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">
                            From your mail server
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal px-4 py-3">
                        <Badge variant={record.present ? "success" : "outline"}>
                          {record.present ? "Found" : "Not found"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {records.some(
          (record) => record.name.endsWith(domain) && record.name !== domain,
        ) && (
          <p className="text-xs text-muted-foreground">
            Some DNS providers add <span className="font-mono">{domain}</span> to the
            host for you. If yours does, enter only the first part, like{" "}
            <span className="font-mono">
              {records
                .find((record) => record.name !== domain)
                ?.name.replace(`.${domain}`, "")}
            </span>
            .
          </p>
        )}

        {name === "DMARC" && result.dmarc.record && (
          <p className="break-all font-mono text-xs text-muted-foreground">
            {result.dmarc.record}
          </p>
        )}

        {name === "DKIM" && (
          <SelectorField
            isSes={isSes}
            found={result.dkim.selector}
            selector={selector}
            onSelectorChange={onSelectorChange}
            defaultOpen={isSes && check.status !== "pass"}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Where to enter the DKIM selector to check. SES tokens are random, so for
 * SES this is how its records get checked at all, and it starts open. */
function SelectorField({
  isSes,
  found,
  selector,
  onSelectorChange,
  defaultOpen,
}: {
  isSes: boolean;
  found: string | null;
  selector: string;
  onSelectorChange: (value: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        {isSes
          ? "Added them? Paste one token to check"
          : "Using another provider's DKIM selector?"}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pt-3 pl-5">
        <Label htmlFor="dkim-selector">
          {isSes ? "Easy DKIM token" : "DKIM selector"}
        </Label>
        <Input
          id="dkim-selector"
          value={selector}
          onChange={(event) => onSelectorChange(event.target.value)}
          placeholder={found ?? (isSes ? "e.g. abc123…" : "e.g. selector1")}
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">
          {isSes
            ? "SES names its DKIM records with random tokens, so SendLit can't find them on its own. Paste one token, or a whole record name, from the SES console's DKIM section, then press Check again."
            : "If your provider signs with its own selector (the part before ._domainkey), enter it and press Check again."}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      title={copied ? "Copied" : "Copy"}
      aria-label={label}
      className="-mt-0.5 shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}
