"use client";

import { ArrowRight, Check, ChevronDown, Mail, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
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
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  type AccountDeletionOrganization,
  type AccountDeletionPreview,
  deleteAccount,
  getAccountDeletion,
  sendAccountDeletionCode,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Status = "ready" | "attention";

const STATUS_STYLE: Record<
  Status,
  { icon: string; bar: string; badge: "success" | "warning" }
> = {
  ready: {
    icon: "bg-[var(--success-soft)] text-[#1f6b35]",
    bar: "bg-[var(--success)]",
    badge: "success",
  },
  attention: {
    icon: "bg-[var(--warning-soft)] text-[var(--warning)]",
    bar: "bg-[var(--warning)]",
    badge: "warning",
  },
};

const BLOCKER_LABEL: Record<
  NonNullable<AccountDeletionOrganization["blocker"]>,
  string
> = {
  active_subscription_exists: "Cancel billing first",
  billing_checkout_pending: "Checkout in progress",
  last_organization_owner: "Add another owner first",
  billing_manager_required: "Move billing first",
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function summaryOf(organization: AccountDeletionOrganization): string {
  if (organization.action === "leave") {
    return "You leave it. It stays with its other owners.";
  }
  if (organization.status === "closed") {
    return "Already deleted. Its contacts' data is erased.";
  }
  return `Deleted with its ${plural(organization.teamCount, "team")}, contacts and media.`;
}

function instructionOf(organization: AccountDeletionOrganization): string {
  switch (organization.blocker) {
    case "active_subscription_exists":
      return "Cancel this organization's subscription, then delete your account once the paid period ends.";
    case "billing_checkout_pending":
      return "A checkout for this organization is still open. Finish or abandon it, then try again.";
    case "last_organization_owner":
      return "You're its only owner and other people are members. Make one of them an owner, or remove them, so they don't lose their workspace.";
    case "billing_manager_required":
      return "You pay for this organization's subscription. Ask an owner to cancel it or take over billing first.";
    default:
      return organization.action === "leave"
        ? "Nothing to do. Your membership and team access are removed; its contacts, campaigns and billing stay with the organization."
        : "Nothing to do. Its teams stop sending, its keys, sending domains and mailboxes are retired, its media is deleted, and its contacts and their personal data are erased. Suppressed addresses stay blocked. Billing records are kept for accounting, without your name or email.";
  }
}

/**
 * Account deletion (#134): one section per organization saying what happens
 * to it and what has to happen first, then a step that confirms it's really
 * the account's owner (typed email plus an emailed code).
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [typedEmail, setTypedEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSentAt, setCodeSentAt] = useState<Date | null>(null);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const codeId = useId();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await getAccountDeletion();
      setPreview(next);
      // Open what needs attention; fold the rest.
      setExpanded(
        Object.fromEntries(
          next.organizations.map((organization) => [
            organization.organizationId,
            organization.blocker !== null,
          ]),
        ),
      );
    } catch {
      setLoadError("Unable to check your organizations. Please try again.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setTypedEmail("");
    setCode("");
    setCodeSentAt(null);
    setError(null);
    void load();
  }, [open, load]);

  const organizations = preview?.organizations ?? [];
  const blocked = organizations.filter((organization) => organization.blocker);
  const ready = organizations.length - blocked.length;
  const emailMatches =
    preview !== null && typedEmail.trim().toLowerCase() === preview.email.toLowerCase();
  const canDelete =
    preview !== null && !preview.blocked && emailMatches && code.trim().length > 0;

  async function sendCode() {
    setSending(true);
    setError(null);
    try {
      await sendAccountDeletionCode();
      setCodeSentAt(new Date());
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? "Too many codes requested. Wait a minute and try again."
          : "Unable to send the code. Please try again.",
      );
    } finally {
      setSending(false);
    }
  }

  async function confirmDelete() {
    if (!preview) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount(typedEmail.trim(), code.trim());
      onDeleted();
    } catch (failure) {
      const reason = failure instanceof ApiError ? failure.message : null;
      if (reason === "account_deletion_blocked") {
        setError(
          "Something changed in one of your organizations. Check the list above.",
        );
        await load();
      } else if (reason === "invalid_code") {
        setError("That code is wrong or has expired. Send a new one and try again.");
      } else if (reason === "email_mismatch") {
        setError("Type your account's email exactly as shown.");
      } else {
        setError("Unable to delete your account. Please try again.");
      }
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90vh] flex-col p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            Delete{" "}
            {preview ? (
              <span className="font-mono">{preview.email}</span>
            ) : (
              "your account"
            )}
          </DialogTitle>
          <DialogDescription>
            Your name and email are erased and you're signed out everywhere.
            Organizations only you own are deleted with their contacts. This can't be
            undone.
          </DialogDescription>
          {preview && organizations.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
              <div className="flex gap-1" aria-hidden>
                {organizations.map((organization) => (
                  <span
                    key={organization.organizationId}
                    className={cn(
                      "h-1.5 w-10 rounded-full",
                      STATUS_STYLE[organization.blocker ? "attention" : "ready"].bar,
                    )}
                  />
                ))}
              </div>
              <span className="font-medium">
                {ready} of {plural(organizations.length, "organization")} ready
              </span>
              <span className="text-muted-foreground">
                {blocked.length === 0
                  ? "Nothing is in the way"
                  : `${blocked.map((organization) => organization.name).join(", ")} ${blocked.length === 1 ? "needs" : "need"} attention`}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {loadError && <Banner>{loadError}</Banner>}
          {!preview && !loadError && <Loading />}
          {preview &&
            organizations.map((organization) => (
              <OrganizationSection
                key={organization.organizationId}
                organization={organization}
                open={expanded[organization.organizationId] ?? false}
                onOpenChange={(value) =>
                  setExpanded((current) => ({
                    ...current,
                    [organization.organizationId]: value,
                  }))
                }
                onNavigate={() => onOpenChange(false)}
              />
            ))}
          {preview && (
            <div className="rounded-lg border bg-card px-5 py-4">
              <div className="flex items-center gap-4">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
                    STATUS_STYLE[emailMatches && codeSentAt ? "ready" : "attention"]
                      .icon,
                  )}
                  aria-hidden
                >
                  {emailMatches && code ? <Check className="size-4" /> : "!"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Confirm it's you</span>
                  <span className="block text-sm text-muted-foreground">
                    Type your email and enter the code we send to it.
                  </span>
                </span>
                <Badge variant={emailMatches && code ? "success" : "warning"}>
                  {emailMatches && code ? "Confirmed" : "Needs confirmation"}
                </Badge>
              </div>
              <div className="mt-4 space-y-4 sm:pl-[3.25rem]">
                <div className="space-y-1.5">
                  <Label htmlFor={emailId}>
                    Type{" "}
                    <span className="font-mono font-semibold">{preview.email}</span> to
                    confirm
                  </Label>
                  <Input
                    id={emailId}
                    autoComplete="off"
                    value={typedEmail}
                    disabled={preview.blocked || deleting}
                    onChange={(event) => setTypedEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={codeId}>Code from your email</Label>
                  <div className="flex gap-2">
                    <Input
                      id={codeId}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="font-mono"
                      value={code}
                      disabled={preview.blocked || deleting}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={preview.blocked || sending || deleting}
                      onClick={() => void sendCode()}
                    >
                      <Mail className="size-4" />
                      {sending ? "Sending…" : codeSentAt ? "Send again" : "Send code"}
                    </Button>
                  </div>
                  {codeSentAt && (
                    <p className="text-sm text-muted-foreground">
                      We sent a code to{" "}
                      <span className="font-mono">{preview.email}</span>.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">Codes expire after 5 minutes.</p>
          <div className="flex gap-2.5">
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={!canDelete || deleting}
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrganizationSection({
  organization,
  open,
  onOpenChange,
  onNavigate,
}: {
  organization: AccountDeletionOrganization;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const status: Status = organization.blocker ? "attention" : "ready";
  const badge = organization.blocker
    ? BLOCKER_LABEL[organization.blocker]
    : organization.action === "leave"
      ? "You'll leave"
      : "Will be deleted";
  const billingLink =
    organization.blocker === "active_subscription_exists" ||
    organization.blocker === "billing_checkout_pending" ||
    organization.blocker === "billing_manager_required";
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
            STATUS_STYLE[status].icon,
          )}
          aria-hidden
        >
          {status === "ready" ? <Check className="size-4" /> : "!"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{organization.name}</span>
          <span className="block text-sm text-muted-foreground">
            {summaryOf(organization)}
          </span>
        </span>
        <Badge variant={STATUS_STYLE[status].badge}>{badge}</Badge>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-5 pb-5 sm:pl-[4.75rem]">
        <p className="text-sm">{instructionOf(organization)}</p>
        {organization.blocker && (
          <Link
            href={`/organizations?organization=${organization.organizationId}${billingLink ? "&tab=plan" : "&tab=members"}`}
            onClick={onNavigate}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {billingLink ? "Manage billing" : "Manage members"}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
        <p className="font-mono text-xs text-muted-foreground">
          {organization.organizationId}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
