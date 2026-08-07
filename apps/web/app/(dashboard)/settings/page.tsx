"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    CheckCircle2,
    Mail,
    Pencil,
    Plus,
    Send,
    Star,
    Trash2,
    XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/codelit/button";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { Textarea } from "@/components/ui/codelit/textarea";
import { Switch } from "@/components/ui/codelit/switch";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/codelit/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/codelit/select";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/codelit/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import { DeleteConfirmationDialog } from "@/components/dashboard/delete-confirmation-dialog";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { EspConfigurationDialog } from "@/components/dashboard/esp-configuration-dialog";
import { ApiError } from "@/lib/api-client";
import {
    activateEsp,
    createEsp,
    deleteEsp,
    feedbackCapableProviders,
    getGeneralSettings,
    getTeamDeliverySettings,
    listEsps,
    testEsp,
    setTeamEspAsDefault,
    updateEsp,
    updateGeneralSettings,
    type EspConfig,
    type EspProvider,
    type GeneralSettings,
} from "@/lib/api";
import { EspFeedbackDialog } from "@/components/dashboard/esp-feedback-dialog";

const PROVIDERS: { value: EspProvider; label: string }[] = [
    { value: "smtp", label: "Custom SMTP" },
    { value: "sendgrid", label: "SendGrid" },
    { value: "mailgun", label: "Mailgun" },
    { value: "postmark", label: "Postmark" },
    { value: "ses", label: "Amazon SES" },
    { value: "resend", label: "Resend" },
];

const PROVIDER_LABEL: Record<EspProvider, string> = Object.fromEntries(
    PROVIDERS.map((p) => [p.value, p.label]),
) as Record<EspProvider, string>;

const SETTINGS_TABS = ["general", "esp"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(value: string | null): value is SettingsTab {
    return SETTINGS_TABS.includes(value as SettingsTab);
}

export default function SettingsPage() {
    useSetBreadcrumb([{ label: "Settings" }]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const selectedTab = isSettingsTab(searchParams.get("tab"))
        ? searchParams.get("tab")!
        : "general";
    const [generalSettings, setGeneralSettings] = useState<
        GeneralSettings | undefined
    >(undefined);
    const [mailingAddress, setMailingAddress] = useState("");
    const [esps, setEsps] = useState<EspConfig[] | null>(null);
    const [defaultTeamEspId, setDefaultTeamEspId] = useState<string | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    const [savingGeneral, setSavingGeneral] = useState(false);
    const [generalSaved, setGeneralSaved] = useState(false);
    const [espFormOpen, setEspFormOpen] = useState(false);
    const [editingEsp, setEditingEsp] = useState<EspConfig | null>(null);
    const [espPendingDelete, setEspPendingDelete] = useState<EspConfig | null>(
        null,
    );
    const [feedbackEsp, setFeedbackEsp] = useState<EspConfig | null>(null);
    const [testingEspId, setTestingEspId] = useState<string | null>(null);
    const [activatingEspId, setActivatingEspId] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{
        espId: string;
        success: boolean;
        error?: string;
    } | null>(null);

    async function load() {
        try {
            const [general, { items }, deliverySettings] = await Promise.all([
                getGeneralSettings(),
                listEsps(),
                getTeamDeliverySettings(),
            ]);
            setGeneralSettings(general);
            setMailingAddress(general.mailingAddress ?? "");
            setEsps(items);
            setDefaultTeamEspId(deliverySettings.defaultTeamEspId);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load settings",
            );
            setGeneralSettings({ mailingAddress: null });
            setEsps([]);
        }
    }

    useEffect(() => {
        load();
    }, []);

    function selectTab(tab: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "general") {
            params.delete("tab");
        } else {
            params.set("tab", tab);
        }
        const query = params.toString();
        router.replace(`/settings${query ? `?${query}` : ""}`, {
            scroll: false,
        });
    }

    async function saveGeneral() {
        setSavingGeneral(true);
        setError(null);
        try {
            const updated = await updateGeneralSettings({
                mailingAddress,
            });
            setGeneralSettings(updated);
            setMailingAddress(updated.mailingAddress ?? "");
            setGeneralSaved(true);
            setTimeout(() => setGeneralSaved(false), 2000);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to save general settings",
            );
        } finally {
            setSavingGeneral(false);
        }
    }

    async function handleSetDefault(espId: string) {
        setError(null);
        try {
            await setTeamEspAsDefault(espId);
            await load();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to set default ESP",
            );
        }
    }

    async function handleDelete(esp: EspConfig) {
        setError(null);
        try {
            await deleteEsp(esp.espId);
            await load();
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to remove ESP",
            );
        }
    }

    async function handleTest(espId: string) {
        setTestingEspId(espId);
        setTestResult(null);
        setError(null);
        try {
            const result = await testEsp(espId);
            setTestResult({ espId, ...result });
            await load();
        } catch (err) {
            setTestResult({
                espId,
                success: false,
                error:
                    err instanceof ApiError ? err.message : "Test send failed",
            });
        } finally {
            setTestingEspId(null);
        }
    }

    async function handleActivate(esp: EspConfig) {
        setActivatingEspId(esp.espId);
        setError(null);
        try {
            await activateEsp(esp.espId);
            await load();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to activate ESP",
            );
        } finally {
            setActivatingEspId(null);
        }
    }

    if (generalSettings === undefined || esps === null) {
        return <Loading />;
    }

    return (
        <ScrollablePage>
            <div className="w-full">
                <PageHeader
                    title="Settings"
                    description="Manage workspace defaults, compliance details, and email delivery configuration."
                />

                {error && <Banner className="mb-4">{error}</Banner>}

                <DeleteConfirmationDialog
                    open={espPendingDelete !== null}
                    onOpenChange={(open) => {
                        if (!open) setEspPendingDelete(null);
                    }}
                    title="Remove email service provider?"
                    description={`This will permanently remove "${espPendingDelete?.name ?? "this email service provider"}". Sending through it will no longer be available.`}
                    confirmLabel="Remove ESP"
                    onConfirm={async () => {
                        if (!espPendingDelete) return;
                        await handleDelete(espPendingDelete);
                    }}
                />

                <Tabs
                    value={selectedTab}
                    defaultValue="general"
                    onValueChange={selectTab}
                >
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="esp">
                            Email service providers (ESP)
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="general">
                        <div>
                            {generalSettings &&
                                !generalSettings.mailingAddress?.trim() && (
                                    <Banner className="mb-4">
                                        A mailing address is required before
                                        this workspace can send email. Add and
                                        save it below to enable broadcasts,
                                        sequences, transactional email, and ESP
                                        test sends.
                                    </Banner>
                                )}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        Workspace defaults
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="mailing-address">
                                            Mailing address (required to send)
                                        </Label>
                                        <Textarea
                                            id="mailing-address"
                                            value={mailingAddress}
                                            onChange={(e) =>
                                                setMailingAddress(
                                                    e.target.value,
                                                )
                                            }
                                            placeholder="123 Main St, City, Country"
                                            rows={4}
                                            aria-describedby="mailing-address-help"
                                        />
                                        <p
                                            id="mailing-address-help"
                                            className="text-sm text-muted-foreground"
                                        >
                                            Your physical mailing address is
                                            included in email footers and is
                                            required before any email can be
                                            sent.
                                        </p>
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button
                                        onClick={saveGeneral}
                                        disabled={savingGeneral}
                                    >
                                        {generalSaved
                                            ? "Saved"
                                            : savingGeneral
                                              ? "Saving…"
                                              : "Save"}
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="esp">
                        {generalSettings &&
                            !generalSettings.mailingAddress?.trim() && (
                                <Banner className="mb-4">
                                    Add a mailing address in General before
                                    sending an ESP test email or campaign email.
                                </Banner>
                            )}
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <p className="max-w-lg text-sm text-muted-foreground">
                                Configure one or more sending identities. One is
                                the team&apos;s default; sequences, broadcasts,
                                and transactional sends can pin a different one
                                explicitly.
                            </p>
                            <Button
                                onClick={() => {
                                    setEditingEsp(null);
                                    setEspFormOpen(true);
                                }}
                            >
                                <Plus className="size-4" />
                                New ESP
                            </Button>
                        </div>

                        {testResult && (
                            <Banner
                                variant={
                                    testResult.success ? "success" : "error"
                                }
                                className="mb-4"
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    {testResult.success ? (
                                        <CheckCircle2 className="size-4" />
                                    ) : (
                                        <XCircle className="size-4" />
                                    )}
                                    {testResult.success
                                        ? `Test email sent via "${esps.find((e) => e.espId === testResult.espId)?.name ?? "ESP"}".`
                                        : testResult.error ||
                                          "Test send failed."}
                                </span>
                            </Banner>
                        )}

                        {esps.length === 0 ? (
                            <Card>
                                <CardContent className="p-6 text-sm text-muted-foreground">
                                    No ESP configured yet. Add one so sequences,
                                    broadcasts, and transactional sends have
                                    somewhere to go.
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Provider</TableHead>
                                                <TableHead>Sender</TableHead>
                                                <TableHead>Health</TableHead>
                                                <TableHead />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {esps.map((esp) => (
                                                <TableRow key={esp.espId}>
                                                    <TableCell className="font-medium">
                                                        <span className="inline-flex items-center gap-2">
                                                            {esp.name}
                                                            {defaultTeamEspId ===
                                                                esp.espId && (
                                                                <Badge variant="secondary">
                                                                    Default
                                                                </Badge>
                                                            )}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>
                                                        {
                                                            PROVIDER_LABEL[
                                                                esp.provider
                                                            ]
                                                        }
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground">
                                                        {esp.fromEmail ??
                                                            "Not set"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex gap-2">
                                                            <Badge
                                                                variant={
                                                                    esp.status ===
                                                                    "active"
                                                                        ? "success"
                                                                        : "secondary"
                                                                }
                                                            >
                                                                {esp.status}
                                                            </Badge>
                                                            {esp.lastTestStatus ? (
                                                                <Badge
                                                                    variant={
                                                                        esp.lastTestStatus ===
                                                                        "success"
                                                                            ? "success"
                                                                            : "destructive"
                                                                    }
                                                                >
                                                                    {
                                                                        esp.lastTestStatus
                                                                    }
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-muted-foreground">
                                                                    Not tested
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center justify-end gap-1">
                                                            {esp.status ===
                                                                "draft" && (
                                                                <IconButton
                                                                    title={
                                                                        esp.lastTestStatus ===
                                                                        "success"
                                                                            ? "Activate ESP"
                                                                            : "Send a successful test before activating"
                                                                    }
                                                                    aria-label={`Activate ${esp.name}`}
                                                                    disabled={
                                                                        activatingEspId ===
                                                                            esp.espId ||
                                                                        esp.lastTestStatus !==
                                                                            "success" ||
                                                                        !esp.fromEmail
                                                                    }
                                                                    onClick={() =>
                                                                        void handleActivate(
                                                                            esp,
                                                                        )
                                                                    }
                                                                >
                                                                    <CheckCircle2 className="size-4" />
                                                                </IconButton>
                                                            )}
                                                            {esp.status ===
                                                                "active" &&
                                                                defaultTeamEspId !==
                                                                    esp.espId && (
                                                                    <IconButton
                                                                        title="Set as default"
                                                                        aria-label={`Set ${esp.name} as default`}
                                                                        onClick={() =>
                                                                            handleSetDefault(
                                                                                esp.espId,
                                                                            )
                                                                        }
                                                                    >
                                                                        <Star className="size-4" />
                                                                    </IconButton>
                                                                )}
                                                            <IconButton
                                                                title="Send test email"
                                                                aria-label={`Send test email via ${esp.name}`}
                                                                disabled={
                                                                    testingEspId ===
                                                                    esp.espId
                                                                }
                                                                onClick={() =>
                                                                    handleTest(
                                                                        esp.espId,
                                                                    )
                                                                }
                                                            >
                                                                <Send className="size-4" />
                                                            </IconButton>
                                                            {feedbackCapableProviders.includes(
                                                                esp.provider,
                                                            ) && (
                                                                <IconButton
                                                                    title="Delivery feedback (bounces & complaints)"
                                                                    aria-label={`Delivery feedback for ${esp.name}`}
                                                                    onClick={() =>
                                                                        setFeedbackEsp(
                                                                            esp,
                                                                        )
                                                                    }
                                                                >
                                                                    <Mail className="size-4" />
                                                                </IconButton>
                                                            )}
                                                            <IconButton
                                                                title="Edit"
                                                                aria-label={`Edit ${esp.name}`}
                                                                onClick={() => {
                                                                    setEditingEsp(
                                                                        esp,
                                                                    );
                                                                    setEspFormOpen(
                                                                        true,
                                                                    );
                                                                }}
                                                            >
                                                                <Pencil className="size-4" />
                                                            </IconButton>
                                                            <IconButton
                                                                title="Remove"
                                                                aria-label={`Remove ${esp.name}`}
                                                                className="text-destructive hover:text-destructive"
                                                                onClick={() =>
                                                                    setEspPendingDelete(
                                                                        esp,
                                                                    )
                                                                }
                                                            >
                                                                <Trash2 className="size-4" />
                                                            </IconButton>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        )}

                        <EspConfigurationDialog
                            open={espFormOpen}
                            onOpenChange={setEspFormOpen}
                            esp={editingEsp}
                            onSubmit={async (input) => {
                                if (editingEsp) {
                                    await updateEsp(editingEsp.espId, input);
                                } else {
                                    await createEsp(input);
                                }
                                await load();
                            }}
                        />
                        <EspFeedbackDialog
                            esp={feedbackEsp}
                            onOpenChange={(open) => {
                                if (!open) setFeedbackEsp(null);
                            }}
                        />
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollablePage>
    );
}

interface EspFormState {
    name: string;
    provider: EspProvider;
    host: string;
    port: string;
    secure: boolean;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
}

const emptyEspForm: EspFormState = {
    name: "",
    provider: "smtp",
    host: "",
    port: "587",
    secure: false,
    username: "",
    password: "",
    fromName: "",
    fromEmail: "",
};

function toEspFormState(esp: EspConfig): EspFormState {
    return {
        name: esp.name,
        provider: esp.provider,
        host: esp.host,
        port: String(esp.port),
        secure: esp.secure,
        username: esp.username ?? "",
        password: "",
        fromName: esp.fromName ?? "",
        fromEmail: esp.fromEmail ?? "",
    };
}

function EspFormDialog({
    open,
    onOpenChange,
    esp,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` creates a new ESP; otherwise edits this one. */
    esp: EspConfig | null;
    onSaved: () => void;
}) {
    const isEdit = Boolean(esp);
    const [form, setForm] = useState<EspFormState>(emptyEspForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setForm(esp ? toEspFormState(esp) : emptyEspForm);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, esp?.espId]);

    async function submit() {
        setSaving(true);
        setError(null);
        try {
            const input = {
                name: form.name,
                provider: form.provider,
                host: form.host,
                port: Number(form.port),
                secure: form.secure,
                username: form.username || undefined,
                password: form.password === "" ? undefined : form.password,
                fromName: form.fromName || undefined,
                fromEmail: form.fromEmail || undefined,
            };
            if (esp) {
                await updateEsp(esp.espId, input);
            } else {
                await createEsp(input);
            }
            onOpenChange(false);
            onSaved();
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to save ESP",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit ESP" : "New ESP"}</DialogTitle>
                </DialogHeader>

                {error && <Banner>{error}</Banner>}

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="esp-name">Name</Label>
                        <Input
                            id="esp-name"
                            value={form.name}
                            onChange={(e) =>
                                setForm({ ...form, name: e.target.value })
                            }
                            placeholder="e.g. Marketing SMTP"
                        />
                    </div>

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
                                    esp?.hasPassword
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
                            <Label htmlFor="esp-from-email">From email</Label>
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
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={saving || !form.name || !form.host}
                    >
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
