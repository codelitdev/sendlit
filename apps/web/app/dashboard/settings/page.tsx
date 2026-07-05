"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Send, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    deleteEspConfig,
    getEspConfig,
    testEspConfig,
    updateEspConfig,
    type EspConfig,
    type EspProvider,
} from "@/lib/api";

const PROVIDERS: { value: EspProvider; label: string }[] = [
    { value: "smtp", label: "Custom SMTP" },
    { value: "sendgrid", label: "SendGrid" },
    { value: "mailgun", label: "Mailgun" },
    { value: "postmark", label: "Postmark" },
    { value: "ses", label: "Amazon SES" },
    { value: "resend", label: "Resend" },
    { value: "custom", label: "Other" },
];

interface FormState {
    provider: EspProvider;
    host: string;
    port: string;
    secure: boolean;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
}

const emptyForm: FormState = {
    provider: "smtp",
    host: "",
    port: "587",
    secure: false,
    username: "",
    password: "",
    fromName: "",
    fromEmail: "",
};

function toFormState(config: EspConfig): FormState {
    return {
        provider: config.provider,
        host: config.host,
        port: String(config.port),
        secure: config.secure,
        username: config.username ?? "",
        password: "",
        fromName: config.fromName ?? "",
        fromEmail: config.fromEmail ?? "",
    };
}

export default function EspSettingsPage() {
    const [config, setConfig] = useState<EspConfig | null | undefined>(
        undefined,
    );
    const [form, setForm] = useState<FormState>(emptyForm);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
        success: boolean;
        error?: string;
    } | null>(null);

    async function load() {
        try {
            const existing = await getEspConfig();
            setConfig(existing);
            setForm(existing ? toFormState(existing) : emptyForm);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load ESP settings",
            );
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function save() {
        setSaving(true);
        setError(null);
        setTestResult(null);
        try {
            const updated = await updateEspConfig({
                provider: form.provider,
                host: form.host,
                port: Number(form.port),
                secure: form.secure,
                username: form.username || undefined,
                password: form.password === "" ? undefined : form.password,
                fromName: form.fromName || undefined,
                fromEmail: form.fromEmail || undefined,
            });
            setConfig(updated);
            setForm(toFormState(updated));
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save ESP settings",
            );
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        setError(null);
        try {
            await deleteEspConfig();
            setConfig(null);
            setForm(emptyForm);
            setTestResult(null);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to remove ESP settings",
            );
        }
    }

    async function runTest() {
        setTesting(true);
        setTestResult(null);
        setError(null);
        try {
            const result = await testEspConfig();
            setTestResult(result);
            const refreshed = await getEspConfig();
            setConfig(refreshed);
        } catch (err) {
            setTestResult({
                success: false,
                error:
                    err instanceof ApiError ? err.message : "Test send failed",
            });
        } finally {
            setTesting(false);
        }
    }

    if (config === undefined) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    return (
        <ScrollablePage>
            <div className="max-w-2xl">
                <PageHeader
                    title="Email sending (ESP)"
                    description="Connect your own SMTP provider so broadcasts and sequences send from your own domain/reputation. Any provider that exposes an SMTP relay works — SendGrid, Mailgun, Postmark, Amazon SES, Resend, or a custom server."
                />

                {error && <Banner className="mb-4">{error}</Banner>}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Provider</CardTitle>
                        {config && (
                            <CardDescription>
                                Configured{" "}
                                {config.lastTestedAt && (
                                    <>
                                        · last tested{" "}
                                        {new Date(
                                            config.lastTestedAt,
                                        ).toLocaleString()}{" "}
                                        {config.lastTestStatus === "success" ? (
                                            <Badge variant="success">
                                                success
                                            </Badge>
                                        ) : (
                                            <Badge variant="destructive">
                                                failed
                                            </Badge>
                                        )}
                                    </>
                                )}
                            </CardDescription>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Provider</Label>
                                <Select
                                    value={form.provider}
                                    onValueChange={(provider) =>
                                        setForm({
                                            ...form,
                                            provider: provider as EspProvider,
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PROVIDERS.map((p) => (
                                            <SelectItem
                                                key={p.value}
                                                value={p.value}
                                            >
                                                {p.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end justify-between gap-3 pb-1.5 sm:justify-start">
                                <Label htmlFor="esp-secure">
                                    Use TLS (port 465)
                                </Label>
                                <Switch
                                    id="esp-secure"
                                    checked={form.secure}
                                    onCheckedChange={(secure) =>
                                        setForm({ ...form, secure })
                                    }
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-host">SMTP host</Label>
                                <Input
                                    id="esp-host"
                                    value={form.host}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            host: e.target.value,
                                        })
                                    }
                                    placeholder="smtp.sendgrid.net"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-port">Port</Label>
                                <Input
                                    id="esp-port"
                                    type="number"
                                    value={form.port}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            port: e.target.value,
                                        })
                                    }
                                    placeholder="587"
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-username">Username</Label>
                                <Input
                                    id="esp-username"
                                    value={form.username}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            username: e.target.value,
                                        })
                                    }
                                    autoComplete="off"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-password">
                                    Password / API key
                                </Label>
                                <Input
                                    id="esp-password"
                                    type="password"
                                    value={form.password}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            password: e.target.value,
                                        })
                                    }
                                    placeholder={
                                        config?.hasPassword
                                            ? "•••••••• (saved — leave blank to keep)"
                                            : ""
                                    }
                                    autoComplete="new-password"
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-from-name">From name</Label>
                                <Input
                                    id="esp-from-name"
                                    value={form.fromName}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            fromName: e.target.value,
                                        })
                                    }
                                    placeholder="Your name or company"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="esp-from-email">
                                    From email
                                </Label>
                                <Input
                                    id="esp-from-email"
                                    type="email"
                                    value={form.fromEmail}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            fromEmail: e.target.value,
                                        })
                                    }
                                    placeholder="you@yourdomain.com"
                                />
                            </div>
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
                                        ? "Test email sent successfully."
                                        : testResult.error ||
                                          "Test send failed."}
                                </span>
                            </Banner>
                        )}
                    </CardContent>
                    <CardFooter className="flex-wrap justify-between gap-2">
                        <div className="flex gap-2">
                            <Button
                                onClick={save}
                                disabled={saving || !form.host}
                            >
                                {saved ? "Saved" : saving ? "Saving…" : "Save"}
                            </Button>
                            {config && (
                                <Button
                                    variant="outline"
                                    onClick={runTest}
                                    disabled={testing}
                                >
                                    <Send className="size-4" />
                                    {testing ? "Sending…" : "Send test email"}
                                </Button>
                            )}
                        </div>
                        {config && (
                            <Button
                                variant="ghost"
                                className="text-destructive"
                                onClick={remove}
                            >
                                <Trash2 className="size-4" />
                                Remove configuration
                            </Button>
                        )}
                    </CardFooter>
                </Card>
            </div>
        </ScrollablePage>
    );
}
