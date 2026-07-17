"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Banner } from "@/components/dashboard/banner";
import { ApiError } from "@/lib/api-client";
import {
    deleteEspFeedback,
    getEspFeedback,
    testEspFeedback,
    upsertEspFeedback,
    type EspConfig,
    type FeedbackConnection,
    type FeedbackConnectionStatus,
} from "@/lib/api";

const STATUS_LABEL: Record<FeedbackConnectionStatus, string> = {
    pending: "Waiting for first event",
    healthy: "Healthy",
    stale: "Stale",
    error: "Error",
    retiring: "Retiring",
    disabled: "Disabled",
};

const STATUS_VARIANT: Record<
    FeedbackConnectionStatus,
    "success" | "secondary" | "destructive" | "outline"
> = {
    pending: "secondary",
    healthy: "success",
    stale: "outline",
    error: "destructive",
    retiring: "outline",
    disabled: "outline",
};

interface CredentialCopy {
    /** Field label — providers name this value differently. */
    label: string;
    placeholder: string;
    hint: string;
}

/** Each feedback-capable provider authenticates its webhook differently, so
 * the single credential field is labelled and explained per provider. */
const CREDENTIAL_COPY: Record<string, CredentialCopy> = {
    resend: {
        label: "webhook signing secret",
        placeholder: "whsec_…",
        hint: "The endpoint signing secret from Resend's webhook dashboard (starts with whsec_).",
    },
    postmark: {
        label: "webhook secret",
        placeholder: "Paste the shared secret / header value",
        hint: "A high-entropy value you also configure as Postmark's custom webhook header or Basic auth password.",
    },
    sendgrid: {
        label: "verification key",
        placeholder: "Paste the Signed Event Webhook verification key",
        hint: "The Signed Event Webhook verification key from SendGrid's Mail Settings → Event Webhook (base64, ECDSA public key).",
    },
    mailgun: {
        label: "HTTP webhook signing key",
        placeholder: "Paste the HTTP webhook signing key",
        hint: "Mailgun's HTTP webhook signing key (Sending → Webhooks), used to HMAC-verify each event's timestamp and token.",
    },
};

const DEFAULT_CREDENTIAL_COPY: CredentialCopy = {
    label: "webhook secret",
    placeholder: "Paste the signing secret / shared value",
    hint: "The provider's webhook signing secret.",
};

/**
 * Per-ESP bounce/complaint webhook setup — conditional on that ESP's
 * provider having a reviewed adapter (see `feedbackCapableProviders`). Each
 * ESP owns an independent connection (URL, credential, health); there is no
 * team-default/singleton feedback config. See
 * `apps/api/docs/bounces-and-complaints.md`.
 */
export function EspFeedbackDialog({
    esp,
    onOpenChange,
}: {
    /** `null` closes the dialog. */
    esp: EspConfig | null;
    onOpenChange: (open: boolean) => void;
}) {
    const [connection, setConnection] = useState<FeedbackConnection | null>(
        null,
    );
    const [loading, setLoading] = useState(false);
    const [credential, setCredential] = useState("");
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{
        success: boolean;
        error?: string;
    } | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!esp) return;
        setError(null);
        setTestResult(null);
        setCredential("");
        setLoading(true);
        getEspFeedback(esp.espId)
            .then(setConnection)
            .catch((err) =>
                setError(
                    err instanceof ApiError
                        ? err.message
                        : "Failed to load feedback connection",
                ),
            )
            .finally(() => setLoading(false));
    }, [esp]);

    if (!esp) return null;

    const credentialCopy =
        CREDENTIAL_COPY[esp.provider] ?? DEFAULT_CREDENTIAL_COPY;

    async function save() {
        if (!esp) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await upsertEspFeedback(esp.espId, { credential });
            setConnection(updated);
            setCredential("");
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save feedback connection",
            );
        } finally {
            setSaving(false);
        }
    }

    async function runTest() {
        if (!esp) return;
        setTesting(true);
        setTestResult(null);
        setError(null);
        try {
            const result = await testEspFeedback(esp.espId);
            setTestResult(result);
        } catch (err) {
            setTestResult({
                success: false,
                error: err instanceof ApiError ? err.message : "Test failed",
            });
        } finally {
            setTesting(false);
        }
    }

    async function disable() {
        if (!esp) return;
        if (!confirm("Disable delivery feedback for this ESP?")) return;
        setError(null);
        try {
            await deleteEspFeedback(esp.espId);
            setConnection(null);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to disable feedback connection",
            );
        }
    }

    return (
        <Dialog open={Boolean(esp)} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Delivery feedback — {esp.name}</DialogTitle>
                </DialogHeader>

                {error && <Banner>{error}</Banner>}

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Receives bounce and spam-complaint events from{" "}
                            {esp.name} so SendLit can suppress future sends to
                            addresses that hard-bounce or complain. This URL and
                            secret are unique to this ESP — switching the
                            team&apos;s default ESP never affects it.
                        </p>

                        {connection && (
                            <div className="space-y-1.5">
                                <Label>Webhook URL</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        readOnly
                                        value={connection.webhookUrl}
                                        className="font-mono text-xs"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        title="Copy"
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                connection.webhookUrl,
                                            );
                                            setCopied(true);
                                            setTimeout(
                                                () => setCopied(false),
                                                1500,
                                            );
                                        }}
                                    >
                                        <Copy className="size-4" />
                                    </Button>
                                </div>
                                {copied && (
                                    <p className="text-xs text-muted-foreground">
                                        Copied.
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    This URL is an identifier, not a credential
                                    — configure the shared secret below on{" "}
                                    {esp.name}&apos;s side too.
                                </p>
                            </div>
                        )}

                        {connection && (
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                                <Badge
                                    variant={STATUS_VARIANT[connection.status]}
                                >
                                    {STATUS_LABEL[connection.status]}
                                </Badge>
                                {connection.lastReceivedAt && (
                                    <span className="text-muted-foreground">
                                        Last event:{" "}
                                        {new Date(
                                            connection.lastReceivedAt,
                                        ).toLocaleString()}
                                    </span>
                                )}
                                {connection.lastErrorCode && (
                                    <span className="text-destructive">
                                        Last error: {connection.lastErrorCode}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label htmlFor="feedback-credential">
                                {connection ? "Rotate " : ""}
                                {credentialCopy.label}
                            </Label>
                            <Input
                                id="feedback-credential"
                                type="password"
                                value={credential}
                                onChange={(e) => setCredential(e.target.value)}
                                placeholder={credentialCopy.placeholder}
                                autoComplete="new-password"
                            />
                            <p className="text-xs text-muted-foreground">
                                {credentialCopy.hint}
                            </p>
                        </div>

                        {testResult && (
                            <Banner
                                variant={
                                    testResult.success ? "success" : "error"
                                }
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    {testResult.success ? (
                                        <CheckCircle2 className="size-4" />
                                    ) : (
                                        <XCircle className="size-4" />
                                    )}
                                    {testResult.success
                                        ? "Connection verified."
                                        : testResult.error || "Test failed."}
                                </span>
                            </Banner>
                        )}
                    </div>
                )}

                <DialogFooter className="flex-wrap justify-between gap-2 sm:justify-between">
                    <div>
                        {connection && (
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-destructive"
                                onClick={disable}
                            >
                                Disable
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {connection && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={runTest}
                                disabled={testing}
                            >
                                {testing ? "Testing…" : "Test"}
                            </Button>
                        )}
                        <Button
                            type="button"
                            onClick={save}
                            disabled={saving || !credential || loading}
                        >
                            {saving
                                ? "Saving…"
                                : connection
                                  ? "Rotate secret"
                                  : "Save"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
