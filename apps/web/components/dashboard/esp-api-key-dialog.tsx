"use client";

import { ExternalLink, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/dashboard/banner";
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
  type EspConfig,
  removeOrganizationEspManagementCredentials,
  setOrganizationEspManagementCredentials,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";

const ERRORS: Record<string, string> = {
  esp_management_credentials_invalid:
    "Amazon SES refused this key. Check it, and that it may call ses:GetEmailIdentity.",
  provider_domain_unsupported: "Only Amazon SES mailboxes take an API key for now.",
  esp_management_credentials_in_use:
    "Teams' own sending domains use this key. Stop using those domains first.",
};

/** The Amazon SES API key that lets teams register their own sending domains
 * on a shared mailbox. Stored encrypted; never shown again. */
export function EspApiKeyDialog({
  organizationId,
  esp,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  esp: EspConfig | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the form when another mailbox is opened
  useEffect(() => {
    setAccessKeyId("");
    setSecretAccessKey("");
    setRegion("");
    setError(null);
  }, [esp?.espId]);

  async function run(kind: "save" | "remove", action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (ERRORS[err.message] ?? err.message)
          : "Failed to save",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={esp !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col p-0 sm:max-w-xl">
        <DialogHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <DialogTitle>
            Amazon SES API key for <span className="font-mono">{esp?.name}</span>
          </DialogTitle>
          <DialogDescription>
            With an API key, SendLit registers each team's own sending domain in your
            SES account, so teams send signed with their own domain. The SMTP password
            can only send, so this is a separate key.
          </DialogDescription>
          <div className="pt-1">
            <Badge variant={esp?.hasManagementCredentials ? "success" : "warning"}>
              {esp?.hasManagementCredentials ? "Key stored" : "No key yet"}
            </Badge>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          {error && <Banner>{error}</Banner>}
          <p className="text-sm">
            Create an IAM access key allowed{" "}
            <span className="font-mono">ses:CreateEmailIdentity</span>,{" "}
            <span className="font-mono">ses:GetEmailIdentity</span> and{" "}
            <span className="font-mono">ses:DeleteEmailIdentity</span>, then paste it
            here.{" "}
            <a
              href="https://console.aws.amazon.com/iam/home#/users"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Open IAM
              <ExternalLink className="size-3.5" />
            </a>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ses-access-key">Access key ID</Label>
            <Input
              id="ses-access-key"
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ses-secret">Secret access key</Label>
            <Input
              id="ses-secret"
              type="password"
              value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ses-region">Region</Label>
            <Input
              id="ses-region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="From the SMTP host"
              className="max-w-xs font-mono"
            />
          </div>
        </div>
        <DialogFooter className="mt-0 flex-wrap justify-between gap-3 border-t px-6 py-4">
          {esp?.hasManagementCredentials ? (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                esp &&
                void run("remove", () =>
                  removeOrganizationEspManagementCredentials(organizationId, esp.espId),
                )
              }
            >
              {busy === "remove" ? "Removing…" : "Remove key"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              disabled={
                !esp || busy !== null || !accessKeyId.trim() || !secretAccessKey.trim()
              }
              onClick={() =>
                esp &&
                void run("save", () =>
                  setOrganizationEspManagementCredentials(organizationId, esp.espId, {
                    accessKeyId: accessKeyId.trim(),
                    secretAccessKey: secretAccessKey.trim(),
                    ...(region.trim() ? { region: region.trim() } : {}),
                  }),
                )
              }
            >
              <KeyRound className="size-4" />
              {busy === "save" ? "Checking…" : "Save key"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
