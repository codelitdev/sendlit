"use client";

import {
    cloneElement,
    isValidElement,
    useEffect,
    useId,
    useMemo,
    useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Activity,
    Archive,
    CheckCircle2,
    Copy,
    KeyRound,
    LogIn,
    Mail,
    MoreHorizontal,
    Pencil,
    Plus,
    ShieldCheck,
    Send,
    Server,
    Trash2,
    Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { Loading } from "@/components/dashboard/loading";
import { Banner } from "@/components/dashboard/banner";
import { EspFeedbackDialog } from "@/components/dashboard/esp-feedback-dialog";
import { EspConfigurationDialog } from "@/components/dashboard/esp-configuration-dialog";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/codelit/button";
import { Checkbox } from "@/components/ui/codelit/checkbox";
import { IconButton } from "@/components/ui/codelit/icon-button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
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
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/codelit/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/codelit/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
    getOrganizationIdFromCookie,
    notifyTeamsChanged,
    selectOrganizationContext,
    setTeamIdCookie,
} from "@/lib/tokens";
import {
    addOrganizationMember,
    archiveOrganizationTeam,
    activateOrganizationEsp,
    createOrganization,
    createOrganizationEsp,
    createOrganizationKey,
    createOrganizationTeam,
    deleteOrganizationEsp,
    feedbackCapableProviders,
    enterOrganizationTeam,
    getOrganizationDeliveryPolicy,
    getOrganizationUsage,
    getOrganizationMailActivity,
    getOrganizationEspGrant,
    listOrganizationAuditEvents,
    listOrganizationEsps,
    listOrganizationKeys,
    listOrganizationMembers,
    listOrganizations,
    listOrganizationTeams,
    revokeOrganizationKey,
    renameOrganizationTeam,
    removeOrganizationMember,
    resumeOrganizationEsp,
    retireOrganizationEsp,
    suspendOrganizationEsp,
    testOrganizationEsp,
    transitionOrganizationEspGrant,
    updateOrganization,
    updateOrganizationDeliveryPolicy,
    updateOrganizationEsp,
    updateOrganizationMember,
    upsertOrganizationEspGrant,
    type CreatedOrganizationApiKey,
    type EspConfig,
    type EspConnectionInput,
    type EspProvider,
    type Organization,
    type OrganizationAuditEvent,
    type OrganizationApiKey,
    type OrganizationApiKeyScope,
    type OrganizationEspGrant,
    type OrganizationDeliveryPolicy,
    type OrganizationMailActivity,
    type OrganizationMailActivityRangeDays,
    type OrganizationMember,
    type OrganizationTeam,
    type OrganizationUsage,
} from "@/lib/api";

const PROVIDERS: Array<{ value: EspProvider; label: string }> = [
    { value: "smtp", label: "Custom SMTP" },
    { value: "resend", label: "Resend" },
    { value: "postmark", label: "Postmark" },
    { value: "sendgrid", label: "SendGrid" },
    { value: "mailgun", label: "Mailgun" },
    { value: "ses", label: "Amazon SES" },
];

const KEY_SCOPES: Array<{ value: OrganizationApiKeyScope; label: string }> = [
    { value: "organization:read", label: "Read organization" },
    { value: "teams:provision", label: "Provision teams" },
    { value: "teams:read", label: "Read teams" },
    { value: "teams:manage", label: "Manage teams" },
    { value: "teams:keys", label: "Manage team keys" },
    { value: "esps:read", label: "Read shared ESPs" },
    { value: "esps:manage", label: "Manage shared ESPs" },
    { value: "grants:manage", label: "Manage ESP grants" },
    { value: "usage:read", label: "Read quota usage" },
];

function errorMessage(error: unknown, fallback: string) {
    return error instanceof ApiError ? error.message : fallback;
}

const ORGANIZATION_TABS = [
    "general",
    "delivery",
    "teams",
    "members",
    "activity",
    "keys",
] as const;
type OrganizationTab = (typeof ORGANIZATION_TABS)[number];

function isOrganizationTab(value: string | null): value is OrganizationTab {
    return ORGANIZATION_TABS.includes(value as OrganizationTab);
}

export default function OrganizationsPage() {
    useSetBreadcrumb([{ label: "Organizations" }]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const tabFromUrl = searchParams.get("tab");
    const [selectedTab, setSelectedTab] = useState<OrganizationTab>(() =>
        isOrganizationTab(tabFromUrl) ? tabFromUrl : "general",
    );
    const [organizations, setOrganizations] = useState<Organization[] | null>(
        null,
    );
    const [selectedId, setSelectedId] = useState<string | null>(() =>
        getOrganizationIdFromCookie(),
    );
    const [teams, setTeams] = useState<OrganizationTeam[]>([]);
    const [esps, setEsps] = useState<EspConfig[]>([]);
    const [keys, setKeys] = useState<OrganizationApiKey[]>([]);
    const [members, setMembers] = useState<OrganizationMember[]>([]);
    const [usage, setUsage] = useState<OrganizationUsage | null>(null);
    const [mailActivity, setMailActivity] =
        useState<OrganizationMailActivity | null>(null);
    const [mailRangeDays, setMailRangeDays] =
        useState<OrganizationMailActivityRangeDays>(7);
    const [auditEvents, setAuditEvents] = useState<OrganizationAuditEvent[]>(
        [],
    );
    const [policy, setPolicy] = useState<OrganizationDeliveryPolicy | null>(
        null,
    );
    const [grants, setGrants] = useState<
        Record<string, OrganizationEspGrant | null>
    >({});
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [hasManagementAccess, setHasManagementAccess] = useState<
        boolean | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const [savingName, setSavingName] = useState(false);
    const [organizationName, setOrganizationName] = useState("");

    const selectedOrganization = useMemo(
        () =>
            organizations?.find(
                (organization) => organization.organizationId === selectedId,
            ) ?? null,
        [organizations, selectedId],
    );

    async function loadOrganizations(preferredId?: string) {
        setError(null);
        try {
            const result = await listOrganizations();
            setOrganizations(result.items);
            const nextId =
                preferredId &&
                result.items.some((item) => item.organizationId === preferredId)
                    ? preferredId
                    : selectedId &&
                        result.items.some(
                            (item) => item.organizationId === selectedId,
                        )
                      ? selectedId
                      : (result.items[0]?.organizationId ?? null);
            setSelectedId(nextId);
            if (nextId) selectOrganizationContext(nextId);
        } catch (err) {
            setError(errorMessage(err, "Failed to load organizations"));
            setOrganizations([]);
        }
    }

    async function loadDetails(
        organizationId: string,
        options?: { silent?: boolean },
    ) {
        // A silent refresh must keep this tree mounted. Resetting access
        // unmounts every management section, including the one-time key
        // secret dialog.
        if (!options?.silent) {
            setLoadingDetails(true);
            setHasManagementAccess(null);
        }
        setError(null);
        try {
            const [
                teamResult,
                espResult,
                keyResult,
                policyResult,
                memberResult,
                usageResult,
                mailActivityResult,
                auditResult,
            ] = await Promise.all([
                listOrganizationTeams(organizationId),
                listOrganizationEsps(organizationId),
                listOrganizationKeys(organizationId),
                getOrganizationDeliveryPolicy(organizationId),
                listOrganizationMembers(organizationId),
                getOrganizationUsage(organizationId),
                getOrganizationMailActivity(organizationId, mailRangeDays),
                listOrganizationAuditEvents(organizationId),
            ]);
            setTeams(teamResult.items);
            setEsps(espResult.items);
            setKeys(keyResult.items);
            setPolicy(policyResult);
            setMembers(memberResult.items);
            setUsage(usageResult);
            setMailActivity(mailActivityResult);
            setAuditEvents(auditResult.items);
            setHasManagementAccess(true);
            const pairs = await Promise.all(
                teamResult.items.map(
                    async (team) =>
                        [
                            team.teamId,
                            await getOrganizationEspGrant(
                                organizationId,
                                team.teamId,
                            ),
                        ] as const,
                ),
            );
            setGrants(Object.fromEntries(pairs));
        } catch (err) {
            if (
                err instanceof ApiError &&
                err.message === "organization_permission_required"
            ) {
                setHasManagementAccess(false);
                setError(null);
                return;
            }
            setError(errorMessage(err, "Failed to load organization settings"));
        } finally {
            setLoadingDetails(false);
        }
    }

    useEffect(() => {
        void loadOrganizations();
        // Load once on mount; subsequent changes are driven by the selector.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedId) {
            setTeams([]);
            setEsps([]);
            setKeys([]);
            setMembers([]);
            setUsage(null);
            setMailActivity(null);
            setAuditEvents([]);
            setPolicy(null);
            setGrants({});
            return;
        }
        void loadDetails(selectedId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    useEffect(() => {
        if (selectedOrganization)
            setOrganizationName(selectedOrganization.name);
    }, [selectedOrganization]);

    async function refresh() {
        if (selectedId) await loadDetails(selectedId, { silent: true });
        await loadOrganizations(selectedId ?? undefined);
    }

    async function saveName() {
        if (!selectedId || !organizationName.trim()) return;
        setSavingName(true);
        setError(null);
        try {
            await updateOrganization(selectedId, organizationName.trim());
            await loadOrganizations(selectedId);
        } catch (err) {
            setError(errorMessage(err, "Failed to rename organization"));
        } finally {
            setSavingName(false);
        }
    }

    function selectOrganization(organizationId: string) {
        setSelectedId(organizationId);
        selectOrganizationContext(organizationId);
    }

    useEffect(() => {
        if (isOrganizationTab(tabFromUrl)) setSelectedTab(tabFromUrl);
    }, [tabFromUrl]);

    function selectTab(tab: string) {
        if (!isOrganizationTab(tab)) return;
        setSelectedTab(tab);
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "general") {
            params.delete("tab");
        } else {
            params.set("tab", tab);
        }
        const query = params.toString();
        router.replace(`/organizations${query ? `?${query}` : ""}`, {
            scroll: false,
        });
    }

    if (organizations === null) return <Loading />;

    return (
        <ScrollablePage>
            <div className="w-full space-y-6">
                <PageHeader
                    title="Organizations"
                    description="Manage the shared delivery infrastructure that sits above teams. Teams can use a granted mailbox without seeing its credentials."
                    action={
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {organizations.length > 0 ? (
                                <Select
                                    value={selectedId ?? undefined}
                                    onValueChange={selectOrganization}
                                >
                                    <SelectTrigger
                                        id="organization-picker"
                                        aria-label="Organization"
                                        className="min-w-52"
                                    >
                                        <SelectValue placeholder="Select an organization" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {organizations.map((organization) => (
                                            <SelectItem
                                                key={
                                                    organization.organizationId
                                                }
                                                value={
                                                    organization.organizationId
                                                }
                                            >
                                                {organization.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : null}
                            <CreateOrganizationDialog
                                onCreated={(organization) =>
                                    void loadOrganizations(
                                        organization.organizationId,
                                    )
                                }
                            />
                        </div>
                    }
                />

                {error && <Banner>{error}</Banner>}

                {organizations.length === 0 ? (
                    <Card>
                        <CardContent className="p-6 text-sm text-muted-foreground">
                            Create an organization to own shared mailboxes,
                            teams, and integration keys.
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        {selectedId && hasManagementAccess === false && (
                            <Card>
                                <CardContent className="p-6 text-sm text-muted-foreground">
                                    You are a member of this organization, but
                                    only organization owners and administrators
                                    can manage shared mailboxes, teams, and
                                    members. Team content still requires an
                                    explicit team membership.
                                </CardContent>
                            </Card>
                        )}

                        {selectedId && hasManagementAccess === true && (
                            <Tabs
                                value={selectedTab}
                                onValueChange={selectTab}
                                className="gap-6"
                            >
                                <TabsList className="flex h-auto w-full flex-wrap sm:w-fit">
                                    <TabsTrigger
                                        value="general"
                                        onClick={() => selectTab("general")}
                                    >
                                        General
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="delivery"
                                        onClick={() => selectTab("delivery")}
                                    >
                                        Delivery
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="teams"
                                        onClick={() => selectTab("teams")}
                                    >
                                        Teams
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="members"
                                        onClick={() => selectTab("members")}
                                    >
                                        Members
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="activity"
                                        onClick={() => selectTab("activity")}
                                    >
                                        Activity
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="keys"
                                        onClick={() => selectTab("keys")}
                                    >
                                        Keys
                                    </TabsTrigger>
                                </TabsList>
                                {selectedTab === "general" && (
                                    <TabsContent value="general" forceMount>
                                        <Card>
                                            <CardHeader>
                                                <CardTitle>
                                                    Organization
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="space-y-1.5">
                                                    <Label htmlFor="organization-display-name">
                                                        Name
                                                    </Label>
                                                    <Input
                                                        id="organization-display-name"
                                                        value={organizationName}
                                                        onChange={(event) =>
                                                            setOrganizationName(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </div>
                                            </CardContent>
                                            <CardFooter>
                                                <Button
                                                    onClick={() =>
                                                        void saveName()
                                                    }
                                                    disabled={
                                                        savingName ||
                                                        !organizationName.trim() ||
                                                        organizationName.trim() ===
                                                            selectedOrganization?.name
                                                    }
                                                >
                                                    {savingName
                                                        ? "Saving…"
                                                        : "Save"}
                                                </Button>
                                            </CardFooter>
                                        </Card>
                                    </TabsContent>
                                )}
                                {selectedTab === "delivery" && (
                                    <TabsContent
                                        value="delivery"
                                        className="space-y-6"
                                        forceMount
                                    >
                                        <SharedEspsSection
                                            organizationId={selectedId}
                                            esps={esps}
                                            loading={loadingDetails}
                                            onChanged={refresh}
                                            onEspUpdated={(updated) =>
                                                setEsps((current) =>
                                                    current.map((esp) =>
                                                        esp.espId ===
                                                        updated.espId
                                                            ? updated
                                                            : esp,
                                                    ),
                                                )
                                            }
                                            onEspDeleted={(espId) =>
                                                setEsps((current) =>
                                                    current.filter(
                                                        (esp) =>
                                                            esp.espId !== espId,
                                                    ),
                                                )
                                            }
                                        />
                                        <DeliveryPolicySection
                                            organizationId={selectedId}
                                            esps={esps}
                                            policy={policy}
                                            loading={loadingDetails}
                                            onChanged={async () => {
                                                await loadDetails(selectedId);
                                            }}
                                        />
                                    </TabsContent>
                                )}
                                {selectedTab === "teams" && (
                                    <TabsContent value="teams" forceMount>
                                        <TeamsAndGrantsSection
                                            organizationId={selectedId}
                                            teams={teams}
                                            esps={esps}
                                            grants={grants}
                                            loading={loadingDetails}
                                            onChanged={refresh}
                                        />
                                    </TabsContent>
                                )}
                                {selectedTab === "members" && (
                                    <TabsContent value="members" forceMount>
                                        <OrganizationMembersSection
                                            organizationId={selectedId}
                                            members={members}
                                            loading={loadingDetails}
                                            onChanged={refresh}
                                        />
                                    </TabsContent>
                                )}
                                {selectedTab === "activity" && (
                                    <TabsContent value="activity" forceMount>
                                        <OrganizationOperationsSection
                                            usage={usage}
                                            mailActivity={mailActivity}
                                            mailRangeDays={mailRangeDays}
                                            onMailRangeDaysChange={async (
                                                days,
                                            ) => {
                                                setMailRangeDays(days);
                                                if (!selectedId) return;
                                                try {
                                                    setMailActivity(
                                                        await getOrganizationMailActivity(
                                                            selectedId,
                                                            days,
                                                        ),
                                                    );
                                                } catch (err) {
                                                    setError(
                                                        errorMessage(
                                                            err,
                                                            "Failed to load mail activity",
                                                        ),
                                                    );
                                                }
                                            }}
                                            events={auditEvents}
                                            loading={loadingDetails}
                                        />
                                    </TabsContent>
                                )}
                                {selectedTab === "keys" && (
                                    <TabsContent value="keys" forceMount>
                                        <OrganizationKeysSection
                                            organizationId={selectedId}
                                            keys={keys}
                                            loading={loadingDetails}
                                            onChanged={refresh}
                                        />
                                    </TabsContent>
                                )}
                            </Tabs>
                        )}
                    </>
                )}
            </div>
        </ScrollablePage>
    );
}

function CreateOrganizationDialog({
    onCreated,
}: {
    onCreated: (organization: Organization) => void;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit() {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const organization = await createOrganization(name.trim());
            setOpen(false);
            setName("");
            onCreated(organization);
        } catch (err) {
            setError(errorMessage(err, "Failed to create organization"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    New organization
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New organization</DialogTitle>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                <div className="space-y-1.5">
                    <Label htmlFor="organization-name">Name</Label>
                    <Input
                        id="organization-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="e.g. CourseLit"
                    />
                </div>
                <DialogFooter>
                    <Button
                        onClick={() => void submit()}
                        disabled={saving || !name.trim()}
                    >
                        {saving ? "Creating…" : "Create organization"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SharedEspsSection({
    organizationId,
    esps,
    loading,
    onChanged,
    onEspUpdated,
    onEspDeleted,
}: {
    organizationId: string;
    esps: EspConfig[];
    loading: boolean;
    onChanged: () => Promise<void>;
    onEspUpdated: (esp: EspConfig) => void;
    onEspDeleted: (espId: string) => void;
}) {
    const [editing, setEditing] = useState<EspConfig | null | undefined>(
        undefined,
    );
    const [feedbackEsp, setFeedbackEsp] = useState<EspConfig | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [transitioningId, setTransitioningId] = useState<string | null>(null);
    const [retiringEsp, setRetiringEsp] = useState<EspConfig | null>(null);
    const [deletingEsp, setDeletingEsp] = useState<EspConfig | null>(null);

    async function test(espId: string) {
        setTestingId(espId);
        try {
            await testOrganizationEsp(organizationId, espId);
            toast.success(
                "Test email sent. This mailbox is ready to activate.",
                {
                    description: "Use its actions menu, then choose Activate.",
                },
            );
        } catch (err) {
            toast.error("Test email failed", {
                description: errorMessage(
                    err,
                    "Please check the mailbox settings.",
                ),
            });
        } finally {
            setTestingId(null);
        }
    }

    async function transition(esp: EspConfig) {
        setTransitioningId(esp.espId);
        try {
            let updated: EspConfig;
            if (esp.status === "active")
                updated = await suspendOrganizationEsp(
                    organizationId,
                    esp.espId,
                );
            else if (esp.status === "suspended")
                updated = await resumeOrganizationEsp(
                    organizationId,
                    esp.espId,
                );
            else
                updated = await activateOrganizationEsp(
                    organizationId,
                    esp.espId,
                );
            onEspUpdated(updated);
            toast.success(
                updated.status === "active"
                    ? "Shared mailbox is active."
                    : "Shared mailbox is suspended.",
            );
        } catch (err) {
            toast.error("Unable to change mailbox status", {
                description: errorMessage(err, "Please try again."),
            });
        } finally {
            setTransitioningId(null);
        }
    }

    async function retire(esp: EspConfig) {
        setTransitioningId(esp.espId);
        try {
            const updated = await retireOrganizationEsp(
                organizationId,
                esp.espId,
                {
                    transition: "cancel",
                },
            );
            onEspUpdated(updated);
            toast.success("Shared mailbox retired and queued work cancelled.");
        } catch (err) {
            toast.error("Unable to retire shared mailbox", {
                description: errorMessage(err, "Please try again."),
            });
        } finally {
            setTransitioningId(null);
        }
    }

    async function remove(esp: EspConfig) {
        setTransitioningId(esp.espId);
        try {
            await deleteOrganizationEsp(organizationId, esp.espId);
            onEspDeleted(esp.espId);
            toast.success("Shared mailbox deleted.");
        } catch (err) {
            toast.error("Unable to delete shared mailbox", {
                description: errorMessage(err, "Please try again."),
            });
        } finally {
            setTransitioningId(null);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="size-5" />
                        Shared mailboxes
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Shared ESPs are organization-owned. Configure
                        credentials once, then grant the mailbox to selected
                        teams. A team receives only a delivery option after an
                        explicit grant; credentials never enter team APIs.
                    </p>
                </div>
                <Button onClick={() => setEditing(null)}>
                    <Plus className="size-4" />
                    New shared ESP
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <Loading />
                ) : esps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No shared mailbox configured.
                    </p>
                ) : (
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
                                        {esp.name}
                                    </TableCell>
                                    <TableCell>
                                        {PROVIDERS.find(
                                            (item) =>
                                                item.value === esp.provider,
                                        )?.label ?? esp.provider}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {esp.fromEmail ?? "Not set"}
                                    </TableCell>
                                    <TableCell className="space-x-2">
                                        <Badge
                                            variant={
                                                esp.status === "active"
                                                    ? "success"
                                                    : "secondary"
                                            }
                                        >
                                            {esp.status}
                                        </Badge>
                                        {esp.lastTestStatus && (
                                            <Badge
                                                variant={
                                                    esp.lastTestStatus ===
                                                    "success"
                                                        ? "success"
                                                        : "destructive"
                                                }
                                            >
                                                {esp.lastTestStatus}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <IconButton
                                                title="Edit shared ESP"
                                                aria-label={`Edit ${esp.name}`}
                                                onClick={() => setEditing(esp)}
                                            >
                                                <Pencil className="size-4" />
                                            </IconButton>
                                            <IconButton
                                                title="Send test email"
                                                aria-label={`Test ${esp.name}`}
                                                type="button"
                                                disabled={
                                                    testingId === esp.espId
                                                }
                                                onClick={() =>
                                                    void test(esp.espId)
                                                }
                                            >
                                                <Send className="size-4" />
                                            </IconButton>
                                            {feedbackCapableProviders.includes(
                                                esp.provider,
                                            ) && (
                                                <IconButton
                                                    title="Configure delivery feedback"
                                                    aria-label={`Configure delivery feedback for ${esp.name}`}
                                                    onClick={() =>
                                                        setFeedbackEsp(esp)
                                                    }
                                                >
                                                    <Mail className="size-4" />
                                                </IconButton>
                                            )}
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <IconButton
                                                        aria-label={`Mailbox actions for ${esp.name}`}
                                                        variant="outline"
                                                        size="sm"
                                                    >
                                                        <MoreHorizontal />
                                                    </IconButton>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {esp.status !== "retired" &&
                                                        esp.status !==
                                                            "draining" && (
                                                            <DropdownMenuItem
                                                                disabled={
                                                                    transitioningId ===
                                                                    esp.espId
                                                                }
                                                                onSelect={() =>
                                                                    void transition(
                                                                        esp,
                                                                    )
                                                                }
                                                            >
                                                                <Activity />
                                                                {transitioningId ===
                                                                esp.espId
                                                                    ? "Working…"
                                                                    : esp.status ===
                                                                        "active"
                                                                      ? "Suspend"
                                                                      : esp.status ===
                                                                          "suspended"
                                                                        ? "Resume"
                                                                        : "Activate"}
                                                            </DropdownMenuItem>
                                                        )}
                                                    <DropdownMenuSeparator />
                                                    {esp.status !==
                                                    "retired" ? (
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            disabled={
                                                                transitioningId ===
                                                                esp.espId
                                                            }
                                                            onSelect={() =>
                                                                setRetiringEsp(
                                                                    esp,
                                                                )
                                                            }
                                                        >
                                                            <Archive />
                                                            Retire shared ESP
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            disabled={
                                                                transitioningId ===
                                                                esp.espId
                                                            }
                                                            onSelect={() =>
                                                                setDeletingEsp(
                                                                    esp,
                                                                )
                                                            }
                                                        >
                                                            <Trash2 />
                                                            Delete shared ESP
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
                <AlertDialog
                    open={Boolean(retiringEsp)}
                    onOpenChange={(open) => {
                        if (!open) setRetiringEsp(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Retire {retiringEsp?.name}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                This immediately stops the shared ESP and
                                cancels queued work that depends on it. This
                                action is for organization owners.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>
                                Keep shared ESP
                            </AlertDialogCancel>
                            <AlertDialogAction
                                variant="destructive"
                                onClick={() => {
                                    if (retiringEsp) void retire(retiringEsp);
                                }}
                            >
                                Retire and cancel work
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <AlertDialog
                    open={Boolean(deletingEsp)}
                    onOpenChange={(open) => {
                        if (!open) setDeletingEsp(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                Delete {deletingEsp?.name}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                This permanently removes the retired shared ESP.
                                It cannot be restored.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>
                                Keep shared ESP
                            </AlertDialogCancel>
                            <AlertDialogAction
                                variant="destructive"
                                onClick={() => {
                                    if (deletingEsp) void remove(deletingEsp);
                                }}
                            >
                                Delete shared ESP
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <p className="text-xs text-muted-foreground">
                    A successful test verifies a custom SMTP mailbox; activate
                    it from its actions menu before assigning it to a team.
                    Custom SMTP provides synchronous outcomes only; configure a
                    reviewed-feedback provider when bounce and complaint
                    webhooks are required.
                </p>
            </CardContent>
            <EspConfigurationDialog
                open={editing !== undefined}
                esp={editing ?? null}
                onOpenChange={(open) => {
                    if (!open) setEditing(undefined);
                }}
                createTitle="New shared ESP"
                createLabel="Create ESP"
                saveLabel="Save ESP"
                namePlaceholder="CourseLit delivery"
                onSubmit={async (input) => {
                    if (editing) {
                        await updateOrganizationEsp(
                            organizationId,
                            editing.espId,
                            input,
                        );
                    } else {
                        await createOrganizationEsp(organizationId, input);
                    }
                    await onChanged();
                }}
            />
            <EspFeedbackDialog
                esp={feedbackEsp}
                organizationId={organizationId}
                onOpenChange={(open) => {
                    if (!open) setFeedbackEsp(null);
                }}
            />
        </Card>
    );
}

function OrganizationEspFormDialog({
    organizationId,
    esp,
    onOpenChange,
    onChanged,
}: {
    organizationId: string;
    esp: EspConfig | null | undefined;
    onOpenChange: (open: boolean) => void;
    onChanged: () => Promise<void>;
}) {
    const open = esp !== undefined;
    const editing = esp ?? null;
    const [name, setName] = useState("");
    const [provider, setProvider] = useState<EspProvider>("smtp");
    const [host, setHost] = useState("");
    const [port, setPort] = useState("587");
    const [secure, setSecure] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [fromName, setFromName] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [fromEmailError, setFromEmailError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(editing?.name ?? "");
        setProvider(editing?.provider ?? "smtp");
        setHost(editing?.host ?? "");
        setPort(String(editing?.port ?? 587));
        setSecure(editing?.secure ?? false);
        setUsername(editing?.username ?? "");
        setPassword("");
        setFromName(editing?.fromName ?? "");
        setFromEmail(editing?.fromEmail ?? "");
        setFromEmailError(null);
        setError(null);
    }, [editing, open]);

    async function submit() {
        const parsedPort = Number(port);
        const normalizedFromEmail = fromEmail.trim();
        if (
            !name.trim() ||
            !host.trim() ||
            !normalizedFromEmail ||
            !Number.isInteger(parsedPort)
        )
            return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedFromEmail)) {
            setFromEmailError("Enter a valid sender email address.");
            return;
        }
        setSaving(true);
        setError(null);
        const input: EspConnectionInput & { name: string } = {
            name: name.trim(),
            provider,
            host: host.trim(),
            port: parsedPort,
            secure,
            username: username.trim() || undefined,
            ...(password ? { password } : {}),
            fromName: fromName.trim() || undefined,
            fromEmail: normalizedFromEmail,
        };
        try {
            if (editing)
                await updateOrganizationEsp(
                    organizationId,
                    editing.espId,
                    input,
                );
            else await createOrganizationEsp(organizationId, input);
            onOpenChange(false);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Failed to save shared ESP"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {editing ? `Edit ${editing.name}` : "New shared ESP"}
                    </DialogTitle>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name">
                        <Input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="CourseLit delivery"
                        />
                    </Field>
                    <Field label="Provider">
                        <Select
                            value={provider}
                            onValueChange={(value) =>
                                setProvider(value as EspProvider)
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PROVIDERS.map((item) => (
                                    <SelectItem
                                        key={item.value}
                                        value={item.value}
                                    >
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="SMTP host">
                        <Input
                            value={host}
                            onChange={(event) => setHost(event.target.value)}
                            placeholder="smtp.example.com"
                        />
                    </Field>
                    <Field label="Port">
                        <Input
                            inputMode="numeric"
                            value={port}
                            onChange={(event) => setPort(event.target.value)}
                        />
                    </Field>
                    <Field label="Username">
                        <Input
                            value={username}
                            onChange={(event) =>
                                setUsername(event.target.value)
                            }
                            autoComplete="username"
                        />
                    </Field>
                    <Field
                        label={
                            editing
                                ? "Password (leave blank to keep)"
                                : "Password"
                        }
                    >
                        <Input
                            type="password"
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            autoComplete="new-password"
                        />
                    </Field>
                    <Field label="From name">
                        <Input
                            value={fromName}
                            onChange={(event) =>
                                setFromName(event.target.value)
                            }
                            placeholder="CourseLit"
                        />
                    </Field>
                    <Field label="From email">
                        <Input
                            id="shared-esp-from-email"
                            type="email"
                            value={fromEmail}
                            onChange={(event) => {
                                setFromEmail(event.target.value);
                                setFromEmailError(null);
                            }}
                            placeholder="no-reply@example.com"
                            aria-invalid={Boolean(fromEmailError)}
                            aria-describedby={
                                fromEmailError
                                    ? "shared-esp-from-email-error"
                                    : undefined
                            }
                        />
                    </Field>
                    {fromEmailError && (
                        <p
                            id="shared-esp-from-email-error"
                            className="-mt-2 text-sm text-destructive"
                        >
                            {fromEmailError}
                        </p>
                    )}
                    <label className="col-span-full flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={secure}
                            onCheckedChange={(checked) =>
                                setSecure(checked === true)
                            }
                        />
                        Use TLS from connection start
                    </label>
                </div>
                <DialogFooter>
                    <Button
                        onClick={() => void submit()}
                        disabled={
                            saving ||
                            !name.trim() ||
                            !host.trim() ||
                            !fromEmail.trim()
                        }
                    >
                        {saving
                            ? "Saving…"
                            : editing
                              ? "Save ESP"
                              : "Create ESP"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Field({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    const generatedId = useId();
    if (!isValidElement<{ id?: string }>(children)) {
        return (
            <div className="space-y-1.5">
                <Label>{label}</Label>
                {children}
            </div>
        );
    }
    const id = children.props.id ?? generatedId;
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {cloneElement(children, { id })}
        </div>
    );
}

function DeliveryPolicySection({
    organizationId,
    esps,
    policy,
    loading,
    onChanged,
}: {
    organizationId: string;
    esps: EspConfig[];
    policy: OrganizationDeliveryPolicy | null;
    loading: boolean;
    onChanged: () => Promise<void>;
}) {
    const [defaultEspId, setDefaultEspId] = useState("");
    const [autoGrant, setAutoGrant] = useState(false);
    const [dailyLimit, setDailyLimit] = useState("");
    const [monthlyLimit, setMonthlyLimit] = useState("");
    const [aggregateDailyLimit, setAggregateDailyLimit] = useState("");
    const [aggregateMonthlyLimit, setAggregateMonthlyLimit] = useState("");
    const [teamEspEnabled, setTeamEspEnabled] = useState(true);
    const [teamCanChangeDefault, setTeamCanChangeDefault] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setDefaultEspId(policy?.defaultEspId ?? "");
        setAutoGrant(policy?.autoGrantDefaultEsp ?? false);
        setDailyLimit(policy?.defaultDailyLimit?.toString() ?? "");
        setMonthlyLimit(policy?.defaultMonthlyLimit?.toString() ?? "");
        setAggregateDailyLimit(policy?.aggregateDailyLimit?.toString() ?? "");
        setAggregateMonthlyLimit(
            policy?.aggregateMonthlyLimit?.toString() ?? "",
        );
        setTeamEspEnabled(policy?.teamEspEnabledByDefault ?? true);
        setTeamCanChangeDefault(policy?.teamCanChangeDefault ?? true);
    }, [policy]);

    async function save() {
        const numberOrNull = (value: string) =>
            value.trim() ? Number(value) : null;
        if (
            [
                dailyLimit,
                monthlyLimit,
                aggregateDailyLimit,
                aggregateMonthlyLimit,
            ].some(
                (value) =>
                    value.trim() && !Number.isInteger(numberOrNull(value)),
            )
        ) {
            setError("Quota limits must be whole numbers.");
            return;
        }
        if (autoGrant && !defaultEspId) {
            setError(
                "Choose an active shared ESP before enabling automatic grants.",
            );
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await updateOrganizationDeliveryPolicy(organizationId, {
                defaultEspId: defaultEspId || null,
                autoGrantDefaultEsp: autoGrant,
                defaultDailyLimit: numberOrNull(dailyLimit),
                defaultMonthlyLimit: numberOrNull(monthlyLimit),
                aggregateDailyLimit: numberOrNull(aggregateDailyLimit),
                aggregateMonthlyLimit: numberOrNull(aggregateMonthlyLimit),
                teamEspEnabledByDefault: teamEspEnabled,
                teamCanChangeDefault,
            });
            await onChanged();
        } catch (err) {
            setError(
                errorMessage(
                    err,
                    "Failed to update organization delivery policy",
                ),
            );
        } finally {
            setSaving(false);
        }
    }

    const activeEsps = esps.filter((esp) => esp.status === "active");
    return (
        <Card>
            <CardHeader>
                <CardTitle>Default delivery for new teams</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                    This policy powers CourseLit-style provisioning: each new
                    team can automatically receive this shared ESP as its
                    default delivery source and inherit the quota limits below.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <Loading />
                ) : (
                    <>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Default shared ESP">
                                <Select
                                    value={defaultEspId || "none"}
                                    onValueChange={(value) =>
                                        setDefaultEspId(
                                            value === "none" ? "" : value,
                                        )
                                    }
                                >
                                    <SelectTrigger aria-label="Default shared ESP">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">
                                            No default shared ESP
                                        </SelectItem>
                                        {activeEsps.map((esp) => (
                                            <SelectItem
                                                key={esp.espId}
                                                value={esp.espId}
                                            >
                                                {esp.name} · {esp.fromEmail}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Daily limit">
                                    <Input
                                        inputMode="numeric"
                                        value={dailyLimit}
                                        onChange={(event) =>
                                            setDailyLimit(event.target.value)
                                        }
                                        placeholder="No limit"
                                    />
                                </Field>
                                <Field label="Monthly limit">
                                    <Input
                                        inputMode="numeric"
                                        value={monthlyLimit}
                                        onChange={(event) =>
                                            setMonthlyLimit(event.target.value)
                                        }
                                        placeholder="No limit"
                                    />
                                </Field>
                            </div>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-4">
                            <p className="text-sm font-medium">
                                Shared-delivery pool limit
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Optional aggregate guardrail across every team
                                using an organization mailbox. It does not limit
                                team-owned ESP sends.
                            </p>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <Field label="Aggregate daily limit">
                                    <Input
                                        inputMode="numeric"
                                        value={aggregateDailyLimit}
                                        onChange={(event) =>
                                            setAggregateDailyLimit(
                                                event.target.value,
                                            )
                                        }
                                        placeholder="No limit"
                                    />
                                </Field>
                                <Field label="Aggregate monthly limit">
                                    <Input
                                        inputMode="numeric"
                                        value={aggregateMonthlyLimit}
                                        onChange={(event) =>
                                            setAggregateMonthlyLimit(
                                                event.target.value,
                                            )
                                        }
                                        placeholder="No limit"
                                    />
                                </Field>
                            </div>
                        </div>
                        <div className="space-y-2 text-sm">
                            <label className="flex items-center gap-2">
                                <Checkbox
                                    checked={autoGrant}
                                    onCheckedChange={(checked) =>
                                        setAutoGrant(checked === true)
                                    }
                                />
                                Automatically grant this mailbox and make it the
                                delivery default for new teams
                            </label>
                            <label className="flex items-center gap-2">
                                <Checkbox
                                    checked={teamEspEnabled}
                                    onCheckedChange={(checked) =>
                                        setTeamEspEnabled(checked === true)
                                    }
                                />
                                Allow newly provisioned teams to add their own
                                ESPs later
                            </label>
                            <label className="flex items-center gap-2">
                                <Checkbox
                                    checked={teamCanChangeDefault}
                                    onCheckedChange={(checked) =>
                                        setTeamCanChangeDefault(
                                            checked === true,
                                        )
                                    }
                                />
                                Allow team admins to change their default
                                delivery source
                            </label>
                        </div>
                        {error && <Banner>{error}</Banner>}
                    </>
                )}
            </CardContent>
            <CardFooter>
                <Button
                    onClick={() => void save()}
                    disabled={loading || saving}
                >
                    {saving ? "Saving…" : "Save delivery policy"}
                </Button>
            </CardFooter>
        </Card>
    );
}

function TeamsAndGrantsSection({
    organizationId,
    teams,
    esps,
    grants,
    loading,
    onChanged,
}: {
    organizationId: string;
    teams: OrganizationTeam[];
    esps: EspConfig[];
    grants: Record<string, OrganizationEspGrant | null>;
    loading: boolean;
    onChanged: () => Promise<void>;
}) {
    const [newTeamOpen, setNewTeamOpen] = useState(false);
    const activeTeams = teams.filter((team) => team.status !== "archived");
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="size-5" />
                        Teams and mailbox sharing
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Each team can receive one active shared ESP grant. Its
                        members see a sending option, never mailbox credentials.
                    </p>
                </div>
                <Button onClick={() => setNewTeamOpen(true)}>
                    <Plus className="size-4" />
                    New team
                </Button>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Loading />
                ) : activeTeams.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No active teams in this organization.
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-lg border">
                        {activeTeams.map((team) => (
                            <TeamMailboxGrantRow
                                key={team.teamId}
                                organizationId={organizationId}
                                team={team}
                                esps={esps}
                                grant={grants[team.teamId] ?? null}
                                onChanged={onChanged}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
            <CreateOrganizationTeamDialog
                organizationId={organizationId}
                open={newTeamOpen}
                onOpenChange={setNewTeamOpen}
                onCreated={onChanged}
            />
        </Card>
    );
}

function CreateOrganizationTeamDialog({
    organizationId,
    open,
    onOpenChange,
    onCreated,
}: {
    organizationId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => Promise<void>;
}) {
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function submit() {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await createOrganizationTeam(organizationId, name.trim());
            notifyTeamsChanged();
            setName("");
            onOpenChange(false);
            await onCreated();
        } catch (err) {
            setError(errorMessage(err, "Failed to create team"));
        } finally {
            setSaving(false);
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New organization team</DialogTitle>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                <div className="space-y-1.5">
                    <Label htmlFor="organization-team-name">Name</Label>
                    <Input
                        id="organization-team-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="e.g. School A"
                    />
                </div>
                <DialogFooter>
                    <Button
                        onClick={() => void submit()}
                        disabled={saving || !name.trim()}
                    >
                        {saving ? "Creating…" : "Create team"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function TeamMailboxGrantRow({
    organizationId,
    team,
    esps,
    grant,
    onChanged,
}: {
    organizationId: string;
    team: OrganizationTeam;
    esps: EspConfig[];
    grant: OrganizationEspGrant | null;
    onChanged: () => Promise<void>;
}) {
    const router = useRouter();
    const [grantEditorOpen, setGrantEditorOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [enterOpen, setEnterOpen] = useState(false);
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [enterError, setEnterError] = useState<string | null>(null);
    const [archiving, setArchiving] = useState(false);
    const [entering, setEntering] = useState(false);

    const mailbox = grant
        ? esps.find((esp) => esp.espId === grant.espId)
        : null;
    const archived = team.status === "archived";
    const viewerIsMember = Boolean(team.viewerIsMember);

    async function openTeam() {
        setTeamIdCookie(team.teamId);
        notifyTeamsChanged();
        router.push("/");
    }

    async function enterTeam() {
        setEntering(true);
        setEnterError(null);
        try {
            await enterOrganizationTeam(organizationId, team.teamId);
            notifyTeamsChanged();
            setTeamIdCookie(team.teamId);
            setEnterOpen(false);
            toast.success(`You joined ${team.name}`);
            router.push("/");
        } catch (err) {
            setEnterError(errorMessage(err, "Failed to enter team"));
        } finally {
            setEntering(false);
        }
    }

    async function archive() {
        setArchiving(true);
        setArchiveError(null);
        try {
            await archiveOrganizationTeam(organizationId, team.teamId);
            setArchiveOpen(false);
            await onChanged();
        } catch (err) {
            setArchiveError(errorMessage(err, "Failed to archive team"));
        } finally {
            setArchiving(false);
        }
    }

    return (
        <div className="flex items-center gap-3 border-b p-4 last:border-b-0">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate font-medium">{team.name}</p>
                    <Badge
                        variant={
                            archived
                                ? "secondary"
                                : grant?.status === "active"
                                  ? "success"
                                  : "secondary"
                        }
                    >
                        {archived
                            ? "Archived"
                            : (grant?.status ?? "No shared ESP")}
                    </Badge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                    {mailbox
                        ? `${mailbox.name} · ${mailbox.fromEmail}`
                        : team.externalId
                          ? `Provisioned team · ${team.externalId}`
                          : "Human-managed team"}
                </p>
            </div>
            {!archived && !viewerIsMember ? (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEnterOpen(true)}
                >
                    <LogIn className="size-4" />
                    Enter team
                </Button>
            ) : null}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <IconButton
                        aria-label={`Actions for ${team.name}`}
                        variant="outline"
                        size="sm"
                    >
                        <MoreHorizontal />
                    </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {!archived && viewerIsMember ? (
                        <DropdownMenuItem onSelect={() => void openTeam()}>
                            <LogIn />
                            Open team
                        </DropdownMenuItem>
                    ) : !archived ? (
                        <DropdownMenuItem onSelect={() => setEnterOpen(true)}>
                            <LogIn />
                            Enter team
                        </DropdownMenuItem>
                    ) : viewerIsMember ? (
                        <DropdownMenuItem disabled>
                            Already a member
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                        disabled={archived}
                        onSelect={() => setGrantEditorOpen(true)}
                    >
                        <Mail />
                        Mailbox grant settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={archived}
                        onSelect={() => setRenameOpen(true)}
                    >
                        <Pencil />
                        Rename team
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        disabled={archived}
                        onSelect={() => setArchiveOpen(true)}
                    >
                        <Archive />
                        Archive team
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <MailboxGrantDialog
                organizationId={organizationId}
                team={team}
                esps={esps}
                grant={grant}
                open={grantEditorOpen}
                onOpenChange={setGrantEditorOpen}
                onChanged={onChanged}
            />
            <RenameOrganizationTeamDialog
                organizationId={organizationId}
                team={team}
                open={renameOpen}
                onOpenChange={setRenameOpen}
                onChanged={onChanged}
            />
            <AlertDialog open={enterOpen} onOpenChange={setEnterOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Enter {team.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You will become a team admin and can see this team’s
                            contacts, campaigns, and mail history. This is
                            recorded in organization audit activity.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {enterError && <Banner>{enterError}</Banner>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={entering}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={entering}
                            onClick={(event) => {
                                event.preventDefault();
                                void enterTeam();
                            }}
                        >
                            {entering ? "Entering…" : "Enter team"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Archive {team.name}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            The team will disappear from team switchers and can
                            no longer send email. Its history is retained.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {archiveError && <Banner>{archiveError}</Banner>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={archiving}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={archiving}
                            onClick={(event) => {
                                event.preventDefault();
                                void archive();
                            }}
                        >
                            {archiving ? "Archiving…" : "Archive team"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function RenameOrganizationTeamDialog({
    organizationId,
    team,
    open,
    onOpenChange,
    onChanged,
}: {
    organizationId: string;
    team: OrganizationTeam;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChanged: () => Promise<void>;
}) {
    const [name, setName] = useState(team.name);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setName(team.name);
            setError(null);
        }
    }, [open, team.name]);

    async function save() {
        const nextName = name.trim();
        if (!nextName) return;
        setSaving(true);
        setError(null);
        try {
            await renameOrganizationTeam(organizationId, team.teamId, nextName);
            onOpenChange(false);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Failed to rename team"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Rename team</DialogTitle>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                <div className="space-y-1.5">
                    <Label htmlFor={`team-name-${team.teamId}`}>Name</Label>
                    <Input
                        id={`team-name-${team.teamId}`}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                </div>
                <DialogFooter>
                    <Button
                        onClick={() => void save()}
                        disabled={saving || !name.trim()}
                    >
                        {saving ? "Saving…" : "Save name"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MailboxGrantDialog({
    organizationId,
    team,
    esps,
    grant,
    open,
    onOpenChange,
    onChanged,
}: {
    organizationId: string;
    team: OrganizationTeam;
    esps: EspConfig[];
    grant: OrganizationEspGrant | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChanged: () => Promise<void>;
}) {
    const [espId, setEspId] = useState(grant?.espId ?? "");
    const [dailyLimit, setDailyLimit] = useState(
        grant?.dailyLimit?.toString() ?? "",
    );
    const [monthlyLimit, setMonthlyLimit] = useState(
        grant?.monthlyLimit?.toString() ?? "",
    );
    const [makeDefault, setMakeDefault] = useState(!grant);
    const [saving, setSaving] = useState(false);
    const [transitioning, setTransitioning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        setEspId(grant?.espId ?? "");
        setDailyLimit(grant?.dailyLimit?.toString() ?? "");
        setMonthlyLimit(grant?.monthlyLimit?.toString() ?? "");
        setMakeDefault(!grant);
    }, [grant]);
    const activeEsps = esps.filter((esp) => esp.status === "active");
    async function save() {
        if (!espId) return;
        setSaving(true);
        setError(null);
        const numberOrNull = (value: string) =>
            value.trim() ? Number(value) : null;
        try {
            await upsertOrganizationEspGrant(organizationId, team.teamId, {
                espId,
                dailyLimit: numberOrNull(dailyLimit),
                monthlyLimit: numberOrNull(monthlyLimit),
                makeDefault,
            });
            await onChanged();
            onOpenChange(false);
        } catch (err) {
            setError(errorMessage(err, "Failed to assign shared ESP"));
        } finally {
            setSaving(false);
        }
    }
    async function transition(
        action: "suspend" | "resume" | "drain" | "cancel",
    ) {
        if (!grant) return;
        setTransitioning(true);
        setError(null);
        try {
            await transitionOrganizationEspGrant(organizationId, team.teamId, {
                action,
            });
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Unable to update mailbox grant"));
        } finally {
            setTransitioning(false);
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>Mailbox grant settings</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                        {team.name}. Team members can use this mailbox to send
                        email, but never see its credentials.
                    </p>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor={`shared-esp-${team.teamId}`}>
                            Shared ESP
                        </Label>
                        <Select
                            value={espId || undefined}
                            onValueChange={setEspId}
                        >
                            <SelectTrigger
                                aria-label={`Shared ESP for ${team.name}`}
                            >
                                <SelectValue placeholder="Select an active shared ESP" />
                            </SelectTrigger>
                            <SelectContent>
                                {activeEsps.map((esp) => (
                                    <SelectItem
                                        key={esp.espId}
                                        value={esp.espId}
                                    >
                                        {esp.name} · {esp.fromEmail}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor={`daily-limit-${team.teamId}`}>
                                Daily limit
                            </Label>
                            <Input
                                id={`daily-limit-${team.teamId}`}
                                inputMode="numeric"
                                placeholder="No limit"
                                value={dailyLimit}
                                onChange={(event) =>
                                    setDailyLimit(event.target.value)
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor={`monthly-limit-${team.teamId}`}>
                                Monthly limit
                            </Label>
                            <Input
                                id={`monthly-limit-${team.teamId}`}
                                inputMode="numeric"
                                placeholder="No limit"
                                value={monthlyLimit}
                                onChange={(event) =>
                                    setMonthlyLimit(event.target.value)
                                }
                            />
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={makeDefault}
                            onCheckedChange={(checked) =>
                                setMakeDefault(checked === true)
                            }
                        />
                        Make this the team&apos;s default delivery source
                    </label>
                </div>
                {grant && grant.status !== "revoked" && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                        {grant.status === "active" && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={saving || transitioning}
                                onClick={() => void transition("suspend")}
                            >
                                {transitioning ? "Working…" : "Suspend grant"}
                            </Button>
                        )}
                        {grant.status === "suspended" && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={saving || transitioning}
                                onClick={() => void transition("resume")}
                            >
                                {transitioning ? "Working…" : "Resume grant"}
                            </Button>
                        )}
                        {grant.status !== "draining" && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={saving || transitioning}
                                onClick={() => void transition("drain")}
                            >
                                Drain for 24 hours
                            </Button>
                        )}
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive"
                                    disabled={saving || transitioning}
                                >
                                    Revoke grant
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>
                                        Revoke this mailbox grant?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This stops the team from using the
                                        shared mailbox and cancels queued work
                                        sent through it.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>
                                        Keep grant
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                        variant="destructive"
                                        onClick={() =>
                                            void transition("cancel")
                                        }
                                    >
                                        Revoke and cancel work
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                )}
                <DialogFooter>
                    <Button
                        onClick={() => void save()}
                        disabled={saving || transitioning || !espId}
                    >
                        {saving
                            ? "Saving…"
                            : grant
                              ? "Save grant settings"
                              : "Assign shared ESP"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OrganizationMembersSection({
    organizationId,
    members,
    loading,
    onChanged,
}: {
    organizationId: string;
    members: OrganizationMember[];
    loading: boolean;
    onChanged: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<OrganizationMember["role"]>("member");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function addMember() {
        if (!email.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await addOrganizationMember(organizationId, {
                email: email.trim(),
                role,
            });
            setEmail("");
            setRole("member");
            setOpen(false);
            await onChanged();
        } catch (err) {
            const message = errorMessage(
                err,
                "Unable to add organization member",
            );
            setError(
                message === "user_not_found"
                    ? "No SendLit account exists for that email yet. Ask them to sign up, then add them here."
                    : message,
            );
        } finally {
            setSaving(false);
        }
    }

    async function changeRole(
        member: OrganizationMember,
        nextRole: OrganizationMember["role"],
    ) {
        setError(null);
        try {
            await updateOrganizationMember(
                organizationId,
                member.userId,
                nextRole,
            );
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Unable to change member role"));
        }
    }

    async function removeMember(member: OrganizationMember) {
        setError(null);
        try {
            await removeOrganizationMember(organizationId, member.userId);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Unable to remove member"));
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="size-5" />
                        Organization members
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Organization access is separate from team membership and
                        never grants access to a team&apos;s contacts or
                        content.
                    </p>
                </div>
                <Button onClick={() => setOpen(true)}>
                    <Plus className="size-4" />
                    Add existing user
                </Button>
            </CardHeader>
            <CardContent>
                {error && <Banner className="mb-4">{error}</Banner>}
                {loading ? (
                    <Loading />
                ) : members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No organization members.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Member</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {members.map((member) => (
                                <TableRow key={member.userId}>
                                    <TableCell>
                                        <div className="font-medium">
                                            {member.name}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {member.email}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            value={member.role}
                                            onValueChange={(value) =>
                                                void changeRole(
                                                    member,
                                                    value as OrganizationMember["role"],
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                aria-label={`Role for ${member.name}`}
                                                className="w-28"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="owner">
                                                    Owner
                                                </SelectItem>
                                                <SelectItem value="admin">
                                                    Admin
                                                </SelectItem>
                                                <SelectItem value="member">
                                                    Member
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {new Date(
                                            member.createdAt,
                                        ).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    className="text-destructive"
                                                >
                                                    <Trash2 className="size-4" />
                                                    Remove
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        Remove {member.name}?
                                                    </AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This removes
                                                        organization access
                                                        only. It does not change
                                                        any separate team
                                                        memberships.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>
                                                        Keep member
                                                    </AlertDialogCancel>
                                                    <AlertDialogAction
                                                        variant="destructive"
                                                        onClick={() =>
                                                            void removeMember(
                                                                member,
                                                            )
                                                        }
                                                    >
                                                        Remove
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add organization member</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Add a person who already has a SendLit account. We’ll
                        use their email to find their account; invitations for
                        new users are a later workflow.
                    </p>
                    <div className="space-y-4">
                        <Field label="Email address">
                            <Input
                                type="email"
                                value={email}
                                onChange={(event) =>
                                    setEmail(event.target.value)
                                }
                                placeholder="name@example.com"
                            />
                        </Field>
                        <Field label="Organization role">
                            <Select
                                value={role}
                                onValueChange={(value) =>
                                    setRole(value as OrganizationMember["role"])
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="owner">Owner</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="member">
                                        Member
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                        {error && <Banner>{error}</Banner>}
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => void addMember()}
                            disabled={saving || !email.trim()}
                        >
                            {saving ? "Adding…" : "Add member"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function OrganizationOperationsSection({
    usage,
    mailActivity,
    mailRangeDays,
    onMailRangeDaysChange,
    events,
    loading,
}: {
    usage: OrganizationUsage | null;
    mailActivity: OrganizationMailActivity | null;
    mailRangeDays: OrganizationMailActivityRangeDays;
    onMailRangeDaysChange: (
        days: OrganizationMailActivityRangeDays,
    ) => void | Promise<void>;
    events: OrganizationAuditEvent[];
    loading: boolean;
}) {
    const windowLabel = (window: OrganizationUsage["day"]) =>
        window.limit === null
            ? `${window.accepted} accepted`
            : `${window.accepted} accepted · ${window.remaining ?? 0} remaining`;
    return (
        <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Activity className="size-5" />
                            Shared-delivery usage
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Only organization-delivery sends count toward this
                            pool.
                        </p>
                    </CardHeader>
                    <CardContent>
                        {loading || !usage ? (
                            <Loading />
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <UsageWindow
                                    title="Today"
                                    usage={usage.day}
                                    label={windowLabel(usage.day)}
                                />
                                <UsageWindow
                                    title="This month"
                                    usage={usage.month}
                                    label={windowLabel(usage.month)}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="size-5" />
                            Recent audit activity
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            The latest 50 secret-free organization
                            administration events.
                        </p>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Loading />
                        ) : events.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No organization activity recorded yet.
                            </p>
                        ) : (
                            <div className="max-h-64 space-y-3 overflow-y-auto">
                                {events.map((event, index) => (
                                    <div
                                        key={`${event.createdAt}-${event.action}-${index}`}
                                        className="border-b pb-3 last:border-0"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-medium">
                                                {event.action}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(
                                                    event.createdAt,
                                                ).toLocaleString()}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {event.actorType.replace("_", " ")}
                                            {event.teamId
                                                ? ` · ${event.teamId}`
                                                : ""}
                                            {event.espId
                                                ? ` · ${event.espId}`
                                                : ""}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Mail className="size-5" />
                            Transactional mail activity
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Counts are transactional only. Shared-delivery quota
                            remains separate. No email content is shown.
                        </p>
                    </div>
                    <Select
                        value={String(mailRangeDays)}
                        onValueChange={(value) =>
                            void onMailRangeDaysChange(
                                Number(
                                    value,
                                ) as OrganizationMailActivityRangeDays,
                            )
                        }
                    >
                        <SelectTrigger
                            aria-label="Transactional mail activity range"
                            className="w-36"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">Last 1 day</SelectItem>
                            <SelectItem value="3">Last 3 days</SelectItem>
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                        </SelectContent>
                    </Select>
                </CardHeader>
                <CardContent>
                    {loading || !mailActivity ? (
                        <Loading />
                    ) : (
                        <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-4">
                                <MailCountStat
                                    label="Sent"
                                    value={mailActivity.totals.sent}
                                />
                                <MailCountStat
                                    label="Queued"
                                    value={mailActivity.totals.queued}
                                />
                                <MailCountStat
                                    label="Failed"
                                    value={mailActivity.totals.failed}
                                />
                                <MailCountStat
                                    label="Bounced"
                                    value={mailActivity.totals.bounced}
                                />
                            </div>
                            {mailActivity.teams.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No teams in this organization.
                                </p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Team</TableHead>
                                                <TableHead className="text-right">
                                                    Sent
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    Queued
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    Failed
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    Bounced
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {mailActivity.teams.map((team) => (
                                                <TableRow
                                                    key={team.teamId}
                                                    className={
                                                        team.status ===
                                                        "archived"
                                                            ? "text-muted-foreground"
                                                            : undefined
                                                    }
                                                >
                                                    <TableCell>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-medium text-foreground">
                                                                {team.name}
                                                            </span>
                                                            {team.externalId ? (
                                                                <Badge variant="secondary">
                                                                    Provisioned
                                                                    ·{" "}
                                                                    {
                                                                        team.externalId
                                                                    }
                                                                </Badge>
                                                            ) : null}
                                                            {team.status ===
                                                            "archived" ? (
                                                                <Badge variant="secondary">
                                                                    Archived
                                                                </Badge>
                                                            ) : null}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {team.mail.sent}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {team.mail.queued}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {team.mail.failed}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {team.mail.bounced}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function MailCountStat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        </div>
    );
}

function UsageWindow({
    title,
    usage,
    label,
}: {
    title: string;
    usage: OrganizationUsage["day"];
    label: string;
}) {
    return (
        <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
                {label}
                {usage.reserved > 0 ? ` · ${usage.reserved} queued` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
                {usage.limit === null
                    ? "No aggregate limit"
                    : `Limit ${usage.limit}`}{" "}
                · resets {new Date(usage.resetsAt).toLocaleString()}
            </p>
        </div>
    );
}

function OrganizationKeysSection({
    organizationId,
    keys,
    loading,
    onChanged,
}: {
    organizationId: string;
    keys: OrganizationApiKey[];
    loading: boolean;
    onChanged: () => Promise<void>;
}) {
    const [newKeyOpen, setNewKeyOpen] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const activeKeys = keys.filter((key) => !key.revokedAt);
    async function revoke(keyId: string) {
        setRevokingId(keyId);
        setError(null);
        try {
            await revokeOrganizationKey(organizationId, keyId);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Failed to revoke key"));
        } finally {
            setRevokingId(null);
        }
    }
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <KeyRound className="size-5" />
                        Organization API keys
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Use scoped keys for server-to-server provisioning.
                        Secrets are shown once and are never stored in the
                        browser.
                    </p>
                </div>
                <Button type="button" onClick={() => setNewKeyOpen(true)}>
                    <Plus className="size-4" />
                    New key
                </Button>
            </CardHeader>
            <CardContent>
                {error && <Banner className="mb-4">{error}</Banner>}
                {loading ? (
                    <Loading />
                ) : activeKeys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No organization keys yet.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Prefix</TableHead>
                                <TableHead>Scopes</TableHead>
                                <TableHead>Last used</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {activeKeys.map((key) => (
                                <TableRow key={key.keyId}>
                                    <TableCell className="font-medium">
                                        {key.name}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                        {key.keyPrefix}
                                    </TableCell>
                                    <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">
                                        {key.scopes.join(", ")}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {key.lastUsedAt
                                            ? new Date(
                                                  key.lastUsedAt,
                                              ).toLocaleString()
                                            : "Never"}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="text-destructive"
                                            disabled={revokingId === key.keyId}
                                            onClick={() =>
                                                void revoke(key.keyId)
                                            }
                                        >
                                            {revokingId === key.keyId
                                                ? "Revoking…"
                                                : "Revoke"}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
            <CreateOrganizationKeyDialog
                organizationId={organizationId}
                open={newKeyOpen}
                onOpenChange={setNewKeyOpen}
                onCreated={onChanged}
            />
        </Card>
    );
}

function CreateOrganizationKeyDialog({
    organizationId,
    open,
    onOpenChange,
    onCreated,
}: {
    organizationId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => Promise<void>;
}) {
    const [name, setName] = useState("");
    const [scopes, setScopes] = useState<OrganizationApiKeyScope[]>(
        KEY_SCOPES.map((scope) => scope.value),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<CreatedOrganizationApiKey | null>(
        null,
    );
    const [copied, setCopied] = useState(false);
    function toggle(scope: OrganizationApiKeyScope) {
        setScopes((current) =>
            current.includes(scope)
                ? current.filter((item) => item !== scope)
                : [...current, scope],
        );
    }
    async function submit() {
        if (!name.trim() || scopes.length === 0) return;
        setSaving(true);
        setError(null);
        try {
            const key = await createOrganizationKey(organizationId, {
                name: name.trim(),
                scopes,
            });
            setCreated(key);
        } catch (err) {
            setError(errorMessage(err, "Failed to create organization key"));
        } finally {
            setSaving(false);
        }
    }
    function close(openState: boolean) {
        if (!openState) {
            const createdKey = created;
            setCreated(null);
            setName("");
            setError(null);
            setCopied(false);
            onOpenChange(openState);
            if (createdKey) void onCreated();
            return;
        }
        onOpenChange(openState);
    }
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {created
                            ? "Store this key now"
                            : "New organization API key"}
                    </DialogTitle>
                </DialogHeader>
                {error && <Banner>{error}</Banner>}
                {created ? (
                    <div className="space-y-3">
                        <Banner variant="success">
                            <span className="inline-flex items-center gap-2">
                                <CheckCircle2 className="size-4" />
                                This is the only time the full secret is
                                displayed.
                            </span>
                        </Banner>
                        <Label>Organization key</Label>
                        <div className="flex gap-2">
                            <Input
                                readOnly
                                value={created.key}
                                className="font-mono text-xs"
                            />
                            <IconButton
                                title="Copy key"
                                aria-label="Copy organization key"
                                onClick={() => {
                                    navigator.clipboard.writeText(created.key);
                                    setCopied(true);
                                }}
                            >
                                <Copy className="size-4" />
                            </IconButton>
                        </div>
                        {copied && (
                            <p className="text-sm text-muted-foreground">
                                Copied.
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <Field label="Key name">
                            <Input
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder="CourseLit production"
                            />
                        </Field>
                        <div className="space-y-2">
                            <Label>Scopes</Label>
                            {KEY_SCOPES.map((scope) => (
                                <label
                                    key={scope.value}
                                    className="flex items-center gap-2 text-sm"
                                >
                                    <Checkbox
                                        checked={scopes.includes(scope.value)}
                                        onCheckedChange={() =>
                                            toggle(scope.value)
                                        }
                                    />
                                    {scope.label}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                <DialogFooter>
                    {created ? (
                        <Button type="button" onClick={() => close(false)}>
                            Done
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={() => void submit()}
                            disabled={
                                saving || !name.trim() || scopes.length === 0
                            }
                        >
                            {saving ? "Creating…" : "Create key"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
