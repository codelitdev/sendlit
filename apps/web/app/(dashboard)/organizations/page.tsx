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
    CalendarClock,
    CheckCircle2,
    Copy,
    LogIn,
    Mail,
    MoreHorizontal,
    Pencil,
    Plus,
    ShieldCheck,
    Send,
    Sparkles,
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
    DialogDescription,
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
import { reloadPage } from "@/lib/navigation";
import { cn } from "@/lib/utils";
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
    abandonPendingOrganization,
    createPaidOrganizationBillingCheckout,
    createOrganizationSendingDomain,
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
    getBillingCatalog,
    getOrganizationBilling,
    createOrganizationBillingCheckout,
    createOrganizationBillingPlanChange,
    createOrganizationBillingPortal,
    type BillingCatalog,
    type OrganizationBilling,
    type OrganizationPlanChange,
    listOrganizationEsps,
    listOrganizationKeys,
    listOrganizationMembers,
    listOrganizationSendingDomains,
    listOrganizations,
    listOrganizationTeams,
    revokeOrganizationKey,
    revokeOrganizationSendingDomain,
    verifyOrganizationSendingDomain,
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
    type SendingDomain,
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

const ORGANIZATION_ERROR_MESSAGES: Record<string, string> = {
    active_subscription_exists:
        "This organization already has an active subscription.",
    billing_catalog_changed:
        "The available pricing changed. Close this dialog and try again to load the latest plans.",
    billing_catalog_unavailable:
        "Plans are temporarily unavailable. Please try again in a moment.",
    billing_checkout_pending:
        "Checkout is already in progress for this organization.",
    billing_manager_required:
        "Only the billing manager can change this organization’s billing.",
    billing_owner_required: "Only the organization owner can manage billing.",
    billing_plan_change_not_supported:
        "That plan change is not available right now. Please try again later.",
    billing_plan_change_pending:
        "A plan change is already being processed for this organization.",
    billing_plan_change_same_plan:
        "This organization is already on that plan and billing interval.",
    billing_provider_unavailable:
        "Billing is temporarily unavailable. Please try again later.",
    billing_human_session_required:
        "For your security, sign in again before changing billing.",
    billing_action_token_invalid:
        "This secure billing request expired or was already used. Please try again.",
    billing_action_token_required:
        "This billing request could not be verified. Please try again.",
    billing_security_unavailable:
        "Secure billing verification is temporarily unavailable. Please try again shortly.",
    csrf_origin_invalid:
        "This billing request could not be verified. Refresh the page and try again.",
    csrf_token_invalid:
        "This billing request expired. Refresh the page and try again.",
    recent_authentication_required:
        "For your security, sign in again before changing billing.",
    billing_subscription_not_changeable:
        "This subscription cannot be changed right now. Please try again later.",
    billing_subscription_required:
        "An active subscription is required for this action.",
    delivery_policy_not_found:
        "Delivery settings are not available for this organization.",
    delivery_source_in_use:
        "This mailbox is still assigned to a team. Remove its assignments and try again.",
    domain_exists: "That sending domain has already been added.",
    domain_invalid: "Enter a valid domain, such as example.com.",
    domain_not_found: "That sending domain could not be found.",
    domain_public_suffix:
        "Use a registrable domain, not a public suffix such as com or co.uk.",
    domain_verification_pending:
        "Domain verification is still pending. Add the DNS record and try again.",
    esp_not_found: "That shared mailbox could not be found.",
    feedback_not_configured:
        "Delivery feedback is not configured for this mailbox yet.",
    feedback_not_supported:
        "This email provider does not support delivery feedback configuration.",
    free_organization_already_owned:
        "You already own a Free organization. Upgrade it first, or choose Pro or Business for this new organization.",
    invalid_lifecycle_transition:
        "That mailbox action is no longer available. Refresh the page and try again.",
    key_not_found: "That organization key could not be found.",
    last_organization_owner:
        "An organization must have at least one owner. Add another owner before changing this role.",
    member_exists: "That person is already a member of this organization.",
    member_not_found: "That organization member could not be found.",
    organization_esp_permission_required:
        "You need organization administrator access to manage shared mailboxes.",
    organization_membership_required:
        "You must be a member of this organization to perform that action.",
    organization_name_already_exists:
        "You already own an organization with this name. Choose a different name.",
    organization_name_required: "Enter an organization name.",
    organization_not_found:
        "This organization is no longer available. Refresh the page and try again.",
    organization_owner_required:
        "Only an organization owner can perform that action.",
    organization_permission_required:
        "You need organization administrator access to perform that action.",
    organization_scope_required:
        "This integration does not have permission to manage the organization.",
    organization_esp_unavailable:
        "The organization mailbox is unavailable. Check its configuration and try again.",
    payment_required:
        "An active subscription or payment method is required for this action.",
    pending_organization_exists:
        "You already have an organization awaiting payment. Finish that checkout before creating another.",
    plan_feature_unavailable:
        "This feature is not available on your current plan. Upgrade to continue.",
    plan_limit_reached:
        "This organization has reached its plan limit. Upgrade to continue.",
    provider_capability_required:
        "This email provider does not support that action.",
    team_archived: "Archived teams cannot be edited.",
    team_not_found: "That team could not be found.",
    team_organization_mismatch:
        "That team does not belong to this organization.",
    user_auth_required: "Please sign in again to continue.",
};

function errorMessage(error: unknown, fallback: string) {
    if (!(error instanceof ApiError)) return fallback;
    const code = error.message.trim();
    const mapped = ORGANIZATION_ERROR_MESSAGES[code];
    if (mapped) return mapped;

    // Never expose an unrecognized machine-readable API code to end users.
    // Preserve ordinary prose from validation/provider responses when it is
    // already suitable for display.
    if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(code)) return fallback;
    return code || fallback;
}

function formatMinorAmount(amountMinor: number, currency: string): string {
    const formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
    });
    const fractionDigits =
        formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** fractionDigits);
}

const ORGANIZATION_TABS = [
    "general",
    "plan",
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

const PLAN_LABELS: Record<OrganizationBilling["plan"], string> = {
    oss: "OSS",
    free: "Free",
    pro: "Pro",
    business: "Business",
};

const PAYMENT_STATUS_LABELS: Record<
    OrganizationBilling["paymentStatus"],
    string
> = {
    free: "No subscription",
    checkout_pending: "Checkout pending",
    trialing: "Trial active",
    active: "Active",
    past_due: "Payment past due",
    cancel_at_period_end: "Cancels at period end",
    cancelled: "Cancelled",
    expired: "Expired",
};

function usageLabel(value: number, limit: number | null): string {
    const formattedValue = value.toLocaleString();
    return limit === null
        ? `${formattedValue} · unlimited`
        : `${formattedValue} / ${limit.toLocaleString()}`;
}

function formatBillingDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function hasFutureBillingDate(value: string | null): boolean {
    if (!value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > Date.now();
}

function usagePercentage(value: number, limit: number | null): number | null {
    if (limit === null) return null;
    return Math.min(100, Math.round((value / Math.max(1, limit)) * 100));
}

function paymentStatusVariant(
    status: OrganizationBilling["paymentStatus"],
): "secondary" | "success" | "destructive" {
    if (status === "active" || status === "trialing") return "success";
    if (status === "past_due") return "destructive";
    return "secondary";
}

function UsageMeter({
    icon,
    label,
    description,
    value,
    limit,
}: {
    icon: React.ReactNode;
    label: string;
    description: string;
    value: number;
    limit: number | null;
}) {
    const percentage = usagePercentage(value, limit);
    const overLimit = limit !== null && value > limit;
    const barWidth = percentage === null ? 0 : percentage;
    const barColor = overLimit
        ? "bg-destructive"
        : percentage !== null && percentage >= 80
          ? "bg-amber-500"
          : "bg-primary";

    return (
        <div className="rounded-xl border bg-background p-4 shadow-sm transition-colors">
            <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p className="text-sm font-medium">{label}</p>
                        {limit === null ? (
                            <Badge variant="secondary">Unlimited</Badge>
                        ) : percentage !== null ? (
                            <span
                                className={cn(
                                    "text-xs font-medium tabular-nums",
                                    overLimit
                                        ? "text-destructive"
                                        : percentage >= 80
                                          ? "text-amber-700 dark:text-amber-300"
                                          : "text-muted-foreground",
                                )}
                            >
                                {overLimit
                                    ? "Over limit"
                                    : `${percentage}% used`}
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {description}
                    </p>
                </div>
            </div>
            <p className="mt-4 text-xl font-semibold tracking-tight tabular-nums">
                {usageLabel(value, limit)}
            </p>
            {percentage !== null ? (
                <div
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${label} usage`}
                    aria-valuemin={0}
                    aria-valuemax={limit ?? undefined}
                    aria-valuenow={Math.min(value, limit ?? value)}
                >
                    <div
                        className={cn(
                            "h-full rounded-full transition-[width]",
                            barColor,
                        )}
                        style={{ width: `${barWidth}%` }}
                    />
                </div>
            ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                    No plan cap
                </p>
            )}
        </div>
    );
}

function OrganizationSectionHeader({
    title,
    description,
    action,
}: {
    title: string;
    description: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <CardHeader className="flex flex-col gap-4 border-b bg-muted/10 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <CardTitle>{title}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                    {description}
                </p>
            </div>
            {action ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {action}
                </div>
            ) : null}
        </CardHeader>
    );
}

export default function OrganizationsPage() {
    useSetBreadcrumb([{ label: "Organizations" }]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const tabFromUrl = searchParams.get("tab");
    const confirmingCheckout = searchParams.get("billing") === "confirming";
    const [selectedTab, setSelectedTab] = useState<OrganizationTab>(() =>
        isOrganizationTab(tabFromUrl) ? tabFromUrl : "general",
    );
    const [organizations, setOrganizations] = useState<Organization[] | null>(
        null,
    );
    const [ownsFreeOrganization, setOwnsFreeOrganization] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(() =>
        getOrganizationIdFromCookie(),
    );
    const [teams, setTeams] = useState<OrganizationTeam[]>([]);
    const [esps, setEsps] = useState<EspConfig[]>([]);
    const [keys, setKeys] = useState<OrganizationApiKey[]>([]);
    const [members, setMembers] = useState<OrganizationMember[]>([]);
    const [sendingDomains, setSendingDomains] = useState<SendingDomain[]>([]);
    const [usage, setUsage] = useState<OrganizationUsage | null>(null);
    const [billing, setBilling] = useState<OrganizationBilling | null>(null);
    const [billingDialogOpen, setBillingDialogOpen] = useState(false);
    const [planChangeDialogOpen, setPlanChangeDialogOpen] = useState(false);
    const [checkoutConfirmation, setCheckoutConfirmation] = useState<
        "idle" | "polling" | "confirmed" | "timed_out"
    >("idle");
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
            setOwnsFreeOrganization(Boolean(result.ownsFreeOrganization));
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
            const billingResult = await getOrganizationBilling(organizationId);
            setBilling(billingResult);
        } catch (err) {
            if (!(
                err instanceof ApiError &&
                (err.message === "organization_permission_required" ||
                    err.message === "organization_owner_required")
            )) {
                setError(errorMessage(err, "Failed to load billing"));
            }
        }
        try {
            const [
                teamResult,
                espResult,
                policyResult,
                memberResult,
                domainResult,
                usageResult,
                mailActivityResult,
                auditResult,
            ] = await Promise.all([
                listOrganizationTeams(organizationId),
                listOrganizationEsps(organizationId),
                getOrganizationDeliveryPolicy(organizationId),
                listOrganizationMembers(organizationId),
                listOrganizationSendingDomains(organizationId),
                getOrganizationUsage(organizationId),
                getOrganizationMailActivity(organizationId, mailRangeDays),
                listOrganizationAuditEvents(organizationId),
            ]);
            setTeams(teamResult.items);
            setEsps(espResult.items);
            setPolicy(policyResult);
            setMembers(memberResult.items);
            setSendingDomains(domainResult.items);
            setUsage(usageResult);
            setMailActivity(mailActivityResult);
            setAuditEvents(auditResult.items);
            setHasManagementAccess(true);
            try {
                const keyResult = await listOrganizationKeys(organizationId);
                setKeys(keyResult.items);
            } catch (err) {
                if (
                    err instanceof ApiError &&
                    err.message === "organization_owner_required"
                ) {
                    setKeys([]);
                } else {
                    throw err;
                }
            }
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
                (err.message === "organization_permission_required" ||
                    err.message === "organization_owner_required")
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
        void loadOrganizations(searchParams.get("organization") ?? undefined);
        // Load once on mount; subsequent changes are driven by the selector.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedId) {
            setTeams([]);
            setEsps([]);
            setKeys([]);
            setMembers([]);
            setSendingDomains([]);
            setUsage(null);
            setMailActivity(null);
            setAuditEvents([]);
            setBilling(null);
            setBillingDialogOpen(false);
            setPlanChangeDialogOpen(false);
            setPolicy(null);
            setGrants({});
            return;
        }
        void loadDetails(selectedId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    useEffect(() => {
        if (!confirmingCheckout || !selectedId) return;
        const organizationId = selectedId;
        let cancelled = false;
        const startedAt = Date.now();
        setCheckoutConfirmation("polling");

        async function poll() {
            try {
                const nextBilling =
                    await getOrganizationBilling(organizationId);
                if (cancelled) return;
                setBilling(nextBilling);
                const activated =
                    nextBilling.plan === "pro" ||
                    nextBilling.plan === "business";
                if (activated) {
                    setCheckoutConfirmation("confirmed");
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete("billing");
                    params.delete("organization");
                    router.replace(`/organizations?${params.toString()}`, {
                        scroll: false,
                    });
                    return;
                }
            } catch {
                // Keep polling. The provider webhook may still be in flight.
            }
            if (cancelled) return;
            if (Date.now() - startedAt >= 90_000) {
                setCheckoutConfirmation("timed_out");
                return;
            }
            window.setTimeout(() => void poll(), 2_000);
        }

        void poll();
        return () => {
            cancelled = true;
        };
        // searchParams is intentionally omitted: its value is captured for
        // the one return-flow poll and router.replace removes billing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmingCheckout, selectedId, router]);

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
                                                {organization.status ===
                                                "pending_payment"
                                                    ? " (pending payment)"
                                                    : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : null}
                            <CreateOrganizationDialog
                                hasFreeOrganization={ownsFreeOrganization}
                                onCreated={reloadPage}
                            />
                        </div>
                    }
                />

                {error && <Banner>{error}</Banner>}

                {checkoutConfirmation === "polling" && (
                    <Banner variant="success">
                        Confirming your subscription. We’ll update this
                        organization as soon as the payment provider confirms
                        it.
                    </Banner>
                )}
                {checkoutConfirmation === "confirmed" && (
                    <Banner variant="success">
                        Subscription confirmed. Your organization’s paid
                        features are now available.
                    </Banner>
                )}
                {checkoutConfirmation === "timed_out" && (
                    <Banner>
                        Payment is still being confirmed. Refresh this page in a
                        moment; your organization will update automatically when
                        the provider webhook arrives.
                    </Banner>
                )}

                {organizations.length === 0 ? (
                    <Card>
                        <CardContent className="p-6 text-sm text-muted-foreground">
                            Create an organization to own shared mailboxes,
                            teams, and integration keys.
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        {selectedId &&
                        billing &&
                        hasManagementAccess === false ? (
                            <div className="mb-6">
                                <OrganizationPlanSummary
                                    organizationId={selectedId}
                                    billing={billing}
                                    onUpgrade={() => setBillingDialogOpen(true)}
                                    onChangePlan={() =>
                                        setPlanChangeDialogOpen(true)
                                    }
                                />
                            </div>
                        ) : null}

                        {selectedId &&
                        selectedOrganization?.status === "pending_payment" ? (
                            <Banner className="mb-6">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p>
                                        This organization is awaiting payment
                                        and cannot send until checkout is
                                        confirmed.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={() =>
                                                setBillingDialogOpen(true)
                                            }
                                        >
                                            Resume checkout
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                if (!selectedId) return;
                                                void abandonPendingOrganization(
                                                    selectedId,
                                                )
                                                    .then(() => reloadPage())
                                                    .catch((error) =>
                                                        toast.error(
                                                            errorMessage(
                                                                error,
                                                                "Unable to hide this organization",
                                                            ),
                                                        ),
                                                    );
                                            }}
                                        >
                                            Hide
                                        </Button>
                                    </div>
                                </div>
                            </Banner>
                        ) : null}

                        {selectedId && hasManagementAccess === false && (
                            <Card>
                                <CardContent className="p-6 text-sm text-muted-foreground">
                                    You are a member of this organization, but
                                    only organization owners and administrators
                                    can manage shared mailboxes, teams, and
                                    members. Plan and usage are shown above.
                                    Team content still requires an explicit team
                                    membership.
                                </CardContent>
                            </Card>
                        )}

                        {selectedId && hasManagementAccess === true && (
                            <>
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
                                            value="plan"
                                            onClick={() => selectTab("plan")}
                                        >
                                            Plan
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="delivery"
                                            onClick={() =>
                                                selectTab("delivery")
                                            }
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
                                            onClick={() =>
                                                selectTab("activity")
                                            }
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
                                                <OrganizationSectionHeader
                                                    title="Organization"
                                                    description="Manage the organization name and identity shown across your workspace."
                                                />
                                                <CardContent>
                                                    <div className="space-y-1.5">
                                                        <Label htmlFor="organization-display-name">
                                                            Name
                                                        </Label>
                                                        <Input
                                                            id="organization-display-name"
                                                            value={
                                                                organizationName
                                                            }
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
                                    {selectedTab === "plan" && (
                                        <TabsContent value="plan" forceMount>
                                            {billing ? (
                                                <OrganizationPlanSummary
                                                    organizationId={selectedId}
                                                    billing={billing}
                                                    onUpgrade={() =>
                                                        setBillingDialogOpen(
                                                            true,
                                                        )
                                                    }
                                                    onChangePlan={() =>
                                                        setPlanChangeDialogOpen(
                                                            true,
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <Loading />
                                            )}
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
                                                billing={billing}
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
                                                                esp.espId !==
                                                                espId,
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
                                                    await loadDetails(
                                                        selectedId,
                                                    );
                                                }}
                                            />
                                            <SendingDomainsSection
                                                organizationId={selectedId}
                                                domains={sendingDomains}
                                                onChanged={async () => {
                                                    setSendingDomains(
                                                        (
                                                            await listOrganizationSendingDomains(
                                                                selectedId,
                                                            )
                                                        ).items,
                                                    );
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
                                                billing={billing}
                                                onUpgradeParent={() =>
                                                    selectTab("plan")
                                                }
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
                                        <TabsContent
                                            value="activity"
                                            forceMount
                                        >
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
                                                billing={billing}
                                                onChanged={refresh}
                                            />
                                        </TabsContent>
                                    )}
                                </Tabs>
                                {billing ? (
                                    <>
                                        <OrganizationBillingDialog
                                            organizationId={selectedId}
                                            billing={billing}
                                            open={billingDialogOpen}
                                            onOpenChange={setBillingDialogOpen}
                                        />
                                        {billing.plan !== "free" &&
                                        billing.plan !== "oss" ? (
                                            <OrganizationPlanChangeDialog
                                                organizationId={selectedId}
                                                billing={billing}
                                                open={planChangeDialogOpen}
                                                onOpenChange={
                                                    setPlanChangeDialogOpen
                                                }
                                                onChanged={refresh}
                                            />
                                        ) : null}
                                    </>
                                ) : null}
                            </>
                        )}
                    </>
                )}
            </div>
        </ScrollablePage>
    );
}

function OrganizationPlanSummary({
    organizationId,
    billing,
    onUpgrade,
    onChangePlan,
}: {
    organizationId: string;
    billing: OrganizationBilling;
    onUpgrade: () => void;
    onChangePlan: () => void;
}) {
    const { usage, entitlements } = billing;
    const periodEnd = formatBillingDate(billing.currentPeriodEndsAt);
    const trialEnd = formatBillingDate(billing.trialEndsAt);
    // Providers may represent a period-end cancellation as either an explicit
    // cancel-at-period-end flag or a cancelled subscription that remains paid
    // through the current period. Treat both forms consistently in the UI.
    const cancellationRequested =
        billing.cancelAtPeriodEnd ||
        billing.paymentStatus === "cancel_at_period_end" ||
        billing.paymentStatus === "cancelled";
    const cancellationPending =
        cancellationRequested &&
        (billing.plan === "pro" || billing.plan === "business") &&
        hasFutureBillingDate(billing.currentPeriodEndsAt);
    const subscriptionExpired =
        billing.paymentStatus === "expired" ||
        (billing.plan === "free" && billing.paymentStatus === "cancelled");
    const periodLabel = subscriptionExpired
        ? periodEnd
            ? `Ended ${periodEnd}`
            : null
        : cancellationPending
          ? periodEnd
              ? `Access until ${periodEnd}`
              : null
          : trialEnd
            ? `Trial ends ${trialEnd}`
            : periodEnd
              ? `Renews ${periodEnd}`
              : null;

    async function openBillingPortal() {
        try {
            const result =
                await createOrganizationBillingPortal(organizationId);
            window.location.assign(result.portalUrl);
        } catch (error) {
            toast.error(errorMessage(error, "Unable to open billing portal"));
        }
    }

    return (
        <Card className="mb-6 overflow-hidden">
            <CardHeader className="border-b bg-muted/10">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <CardTitle>Plan and usage</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Organization-level limits shared across your teams.
                            Members and logins are never billed as seats.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {billing.canManageBilling && billing.plan === "free" ? (
                            <Button variant="outline" onClick={onUpgrade}>
                                Upgrade
                            </Button>
                        ) : null}
                        {billing.canManageBilling &&
                        billing.plan !== "free" &&
                        billing.plan !== "oss" ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={onChangePlan}
                                    disabled={Boolean(
                                        billing.pendingPlanChange,
                                    )}
                                >
                                    Change plan
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => void openBillingPortal()}
                                >
                                    Manage billing
                                </Button>
                            </>
                        ) : null}
                        <Badge
                            variant={
                                billing.plan === "free"
                                    ? "secondary"
                                    : "success"
                            }
                            className="mt-0.5 shrink-0"
                        >
                            {PLAN_LABELS[billing.plan]}
                        </Badge>
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                        {PLAN_LABELS[billing.plan]} plan
                    </span>
                    {billing.billingInterval ? (
                        <span className="text-sm text-muted-foreground">
                            ·{" "}
                            {billing.billingInterval === "month"
                                ? "Monthly"
                                : "Yearly"}{" "}
                            billing
                        </span>
                    ) : null}
                    <Badge
                        variant={paymentStatusVariant(billing.paymentStatus)}
                    >
                        {PAYMENT_STATUS_LABELS[billing.paymentStatus]}
                    </Badge>
                    {periodLabel ? (
                        <span className="text-xs text-muted-foreground">
                            · {periodLabel}
                        </span>
                    ) : null}
                </div>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-semibold">Usage</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Current usage for this organization
                        </p>
                    </div>
                    {formatBillingDate(usage.bucketEndsAt) ? (
                        <span className="text-xs text-muted-foreground">
                            Resets {formatBillingDate(usage.bucketEndsAt)}
                        </span>
                    ) : null}
                </div>
                {(entitlements.subscribedContactsLimit !== null &&
                    usage.subscribedContacts >
                        entitlements.subscribedContactsLimit) ||
                (entitlements.monthlySendsLimit !== null &&
                    usage.monthlySends > entitlements.monthlySendsLimit) ? (
                    <Banner>
                        This organization is over its plan limit
                        {entitlements.subscribedContactsLimit !== null &&
                        usage.subscribedContacts >
                            entitlements.subscribedContactsLimit
                            ? ` (${usage.subscribedContacts} of ${entitlements.subscribedContactsLimit} subscribed contacts)`
                            : ""}
                        {entitlements.monthlySendsLimit !== null &&
                        usage.monthlySends > entitlements.monthlySendsLimit
                            ? ` (${usage.monthlySends} of ${entitlements.monthlySendsLimit} monthly sends)`
                            : ""}
                        . Export, unsubscribe, or delete contacts to get under
                        the cap, then upgrade if you need more capacity.
                    </Banner>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                    <UsageMeter
                        icon={<Users className="size-4" />}
                        label="Teams"
                        description="Active teams"
                        value={usage.teams}
                        limit={entitlements.teamsLimit}
                    />
                    <UsageMeter
                        icon={<Mail className="size-4" />}
                        label="Subscribed contacts"
                        description="Across all teams"
                        value={usage.subscribedContacts}
                        limit={entitlements.subscribedContactsLimit}
                    />
                    <UsageMeter
                        icon={<Send className="size-4" />}
                        label="Monthly sends"
                        description="Resets each month"
                        value={usage.monthlySends}
                        limit={entitlements.monthlySendsLimit}
                    />
                </div>
                {billing.paymentStatus === "past_due" ? (
                    <Banner>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p>
                                Payment is past due
                                {formatBillingDate(billing.graceEndsAt)
                                    ? `. Paid sending remains available until ${formatBillingDate(billing.graceEndsAt)}`
                                    : ""}
                                . Update the card on file to keep paid sending
                                enabled.
                            </p>
                            {billing.canManageBilling ? (
                                <Button
                                    variant="outline"
                                    onClick={() => void openBillingPortal()}
                                >
                                    Manage billing
                                </Button>
                            ) : null}
                        </div>
                    </Banner>
                ) : null}
                {cancellationPending ? (
                    <Banner variant="warning" className="rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
                                <CalendarClock className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold">
                                        Cancellation scheduled
                                    </p>
                                    {periodEnd ? (
                                        <Badge
                                            variant="outline"
                                            className="border-amber-300/70 text-amber-800 dark:border-amber-300/30 dark:text-amber-200"
                                        >
                                            Ends {periodEnd}
                                        </Badge>
                                    ) : null}
                                </div>
                                <p>
                                    Your {PLAN_LABELS[billing.plan]} plan
                                    remains active
                                    {periodEnd
                                        ? ` until ${periodEnd}`
                                        : " through the current billing period"}
                                    . Paid features are available until then.
                                </p>
                                <div className="grid gap-2 pt-1 text-xs sm:grid-cols-2">
                                    <div className="rounded-lg border border-amber-300/60 bg-background/40 p-3 dark:border-amber-300/20">
                                        <p className="font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                                            After expiry
                                        </p>
                                        <p className="mt-1">
                                            The organization moves to Free: 1
                                            active team, 1,000 subscribed
                                            contacts, and 3,000 sends per month.
                                            New additions or sends over those
                                            limits are blocked.
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-amber-300/60 bg-background/40 p-3 dark:border-amber-300/20">
                                        <p className="font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                                            What stays
                                        </p>
                                        <p className="mt-1">
                                            Organizations, teams, contacts,
                                            sequences, broadcasts, templates,
                                            media, logs, and existing keys
                                            remain. Shared mailboxes and grants
                                            stay readable but cannot be used for
                                            new sends.
                                        </p>
                                    </div>
                                </div>
                                <p className="text-xs">
                                    Provisioning and organization-key mutations
                                    stop after expiry. Upgrade this organization
                                    again to restore paid capabilities without
                                    migrating data.
                                </p>
                            </div>
                        </div>
                    </Banner>
                ) : null}
                {subscriptionExpired ? (
                    <Banner variant="info" className="rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <CheckCircle2 className="size-4" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-semibold">
                                    This organization is now on the Free plan.
                                    {periodEnd
                                        ? ` The paid plan ended on ${periodEnd}.`
                                        : null}
                                </p>
                                <p className="text-sm">
                                    Your teams, contacts, sequences, broadcasts,
                                    templates, media, logs, and other data are
                                    retained. Free limits apply; shared
                                    mailboxes and grants remain readable but
                                    cannot be used for new sends. Upgrade again
                                    to restore paid capabilities.
                                </p>
                            </div>
                        </div>
                    </Banner>
                ) : null}
                {!cancellationPending &&
                cancellationRequested &&
                (billing.plan === "pro" || billing.plan === "business") ? (
                    <Banner variant="warning" className="rounded-xl p-4">
                        This subscription is cancelled. Your paid features
                        remain available through the current billing period. The
                        provider has not supplied an exact end date yet.
                    </Banner>
                ) : null}
            </CardContent>
        </Card>
    );
}

function CreateOrganizationDialog({
    hasFreeOrganization,
    onCreated,
}: {
    hasFreeOrganization: boolean;
    onCreated: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [teamName, setTeamName] = useState("");
    const [plan, setPlan] = useState<"oss" | "free" | "pro" | "business">(
        "free",
    );
    const [interval, setInterval] = useState<"month" | "year">("month");
    const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
    const [catalogUnavailable, setCatalogUnavailable] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isOssDeployment =
        catalog?.catalogRevision === null && !catalog.checkoutAvailable;
    const showPlanSelector =
        catalogUnavailable || (catalog !== null && !isOssDeployment);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setPlan(hasFreeOrganization ? "pro" : "free");
        setInterval("month");
        setTeamName("");
        setCatalog(null);
        setCatalogUnavailable(false);
        void (async () => {
            try {
                const nextCatalog = await getBillingCatalog();
                setCatalog(nextCatalog);
                if (
                    nextCatalog.catalogRevision === null &&
                    !nextCatalog.checkoutAvailable
                ) {
                    setPlan("oss");
                } else {
                    setPlan(hasFreeOrganization ? "pro" : "free");
                }
            } catch {
                setCatalog(null);
                setCatalogUnavailable(true);
            }
        })();
    }, [hasFreeOrganization, open]);

    const offer =
        plan === "free" || plan === "oss"
            ? null
            : catalog?.offers.find(
                  (item) => item.plan === plan && item.interval === interval,
              );

    async function submit() {
        if (!name.trim()) return;
        if (
            plan !== "free" &&
            plan !== "oss" &&
            (!catalog?.catalogRevision || !offer)
        ) {
            setError(
                "Paid plans are temporarily unavailable. Please try again.",
            );
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if (plan === "free" || plan === "oss") {
                await createOrganization(name.trim());
                setOpen(false);
                setName("");
                onCreated();
            } else {
                const result = await createPaidOrganizationBillingCheckout({
                    organizationName: name.trim(),
                    teamName: teamName.trim() || `${name.trim()} Team`,
                    plan,
                    interval,
                    catalogRevision: catalog!.catalogRevision!,
                });
                // Activation is webhook-driven; the hosted provider page is
                // the only place where payment details are entered.
                window.location.assign(result.checkoutUrl);
            }
        } catch (err) {
            setError(errorMessage(err, "Failed to create organization"));
        } finally {
            setSaving(false);
        }
    }

    const submitLabel = saving
        ? plan === "free"
            ? "Creating…"
            : "Opening checkout…"
        : !catalog && !catalogUnavailable
          ? "Loading…"
          : plan === "free" || plan === "oss"
            ? "Create organization"
            : "Continue to checkout";

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
                {showPlanSelector ? (
                    <div className="space-y-1.5">
                        <Label>Plan</Label>
                        <Select
                            value={plan}
                            onValueChange={(value) =>
                                setPlan(
                                    value as
                                        "oss" | "free" | "pro" | "business",
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {!hasFreeOrganization ? (
                                    <SelectItem value="free">Free</SelectItem>
                                ) : null}
                                <SelectItem
                                    value="pro"
                                    disabled={
                                        catalogUnavailable ||
                                        Boolean(
                                            catalog &&
                                            !catalog.checkoutAvailable,
                                        )
                                    }
                                >
                                    Pro
                                </SelectItem>
                                <SelectItem
                                    value="business"
                                    disabled={
                                        catalogUnavailable ||
                                        Boolean(
                                            catalog &&
                                            !catalog.checkoutAvailable,
                                        )
                                    }
                                >
                                    Business
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {hasFreeOrganization ? (
                            <p className="text-xs text-muted-foreground">
                                Your existing Free organization means this new
                                organization must use a paid plan.
                            </p>
                        ) : null}
                    </div>
                ) : null}
                {catalogUnavailable ||
                (catalog &&
                    !catalog.checkoutAvailable &&
                    catalog.catalogRevision !== null) ? (
                    <p className="text-sm text-muted-foreground">
                        Paid checkout is not enabled for this deployment.
                    </p>
                ) : null}
                {plan !== "free" && plan !== "oss" ? (
                    <>
                        <div className="space-y-1.5">
                            <Label htmlFor="organization-paid-team-name">
                                First team name
                            </Label>
                            <Input
                                id="organization-paid-team-name"
                                value={teamName}
                                onChange={(event) =>
                                    setTeamName(event.target.value)
                                }
                                placeholder="e.g. Main team"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Billing interval</Label>
                            <Select
                                value={interval}
                                onValueChange={(value) =>
                                    setInterval(value as "month" | "year")
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="month">
                                        Monthly
                                    </SelectItem>
                                    <SelectItem value="year">
                                        Yearly (2 months free)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {offer ? (
                            <p className="text-sm font-medium">
                                {formatMinorAmount(
                                    offer.amountMinor,
                                    offer.currency,
                                )}{" "}
                                / {interval}
                                {offer.trialDays
                                    ? ` · ${offer.trialDays}-day trial`
                                    : ""}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Loading the current provider-configured price…
                            </p>
                        )}
                    </>
                ) : null}
                <DialogFooter>
                    <Button
                        onClick={() => void submit()}
                        disabled={
                            saving ||
                            !name.trim() ||
                            (!catalog && !catalogUnavailable) ||
                            (plan !== "free" &&
                                plan !== "oss" &&
                                (!catalog?.catalogRevision || !offer))
                        }
                    >
                        {submitLabel}
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
    billing,
    onChanged,
    onEspUpdated,
    onEspDeleted,
}: {
    organizationId: string;
    esps: EspConfig[];
    loading: boolean;
    billing: OrganizationBilling | null;
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
    const sharedMailboxEnabled =
        billing === null || billing.entitlements.sharedOrganizationMailbox;

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
            <OrganizationSectionHeader
                title="Shared mailboxes"
                description={
                    <>
                        Shared ESPs are organization-owned. Configure
                        credentials once, then grant the mailbox to selected
                        teams. A team receives only a delivery option after an
                        explicit grant; credentials never enter team APIs.
                    </>
                }
                action={
                    <Button
                        onClick={() => setEditing(null)}
                        disabled={!sharedMailboxEnabled}
                    >
                        <Plus className="size-4" />
                        New shared ESP
                    </Button>
                }
            />
            <CardContent className="space-y-4">
                {!sharedMailboxEnabled ? (
                    <Banner>
                        Shared mailboxes are available on Pro and Business.
                        Upgrade this organization to configure one.
                    </Banner>
                ) : null}
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
            <OrganizationSectionHeader
                title="Default delivery for new teams"
                description={
                    <>
                        This policy powers CourseLit-style provisioning: each
                        new team can automatically receive this shared ESP as
                        its default delivery source and inherit the quota limits
                        below.
                    </>
                }
            />
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

function SendingDomainsSection({
    organizationId,
    domains,
    onChanged,
}: {
    organizationId: string;
    domains: SendingDomain[];
    onChanged: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [domain, setDomain] = useState("");
    const [challenge, setChallenge] = useState<SendingDomain | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<SendingDomain | null>(null);

    async function addDomain() {
        if (!domain.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const created = await createOrganizationSendingDomain(
                organizationId,
                domain.trim(),
            );
            setChallenge(created);
            setDomain("");
            setOpen(false);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Failed to add sending domain"));
        } finally {
            setSaving(false);
        }
    }

    async function verify(domainId: string) {
        setSaving(true);
        setError(null);
        try {
            await verifyOrganizationSendingDomain(organizationId, domainId);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Domain is not verified yet"));
            await onChanged();
        } finally {
            setSaving(false);
        }
    }

    async function revoke() {
        if (!revoking) return;
        setSaving(true);
        setError(null);
        try {
            await revokeOrganizationSendingDomain(
                organizationId,
                revoking.domainId,
            );
            setRevoking(null);
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Failed to revoke sending domain"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <Card>
                <OrganizationSectionHeader
                    title="Sending domains"
                    description="Verify ownership before sending beyond cloud test volume."
                    action={
                        <Button variant="outline" onClick={() => setOpen(true)}>
                            <Plus className="size-4" />
                            Add domain
                        </Button>
                    }
                />
                <CardContent className="space-y-3">
                    {error ? <Banner>{error}</Banner> : null}
                    {challenge ? (
                        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                            <p className="font-medium">
                                Add this DNS TXT record
                            </p>
                            <p className="mt-1 text-muted-foreground">
                                Publish it, then choose Verify. The token is
                                shown only once.
                            </p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        Name
                                    </p>
                                    <code className="break-all text-xs">
                                        {challenge.challengeRecordName}
                                    </code>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        Value
                                    </p>
                                    <code className="break-all text-xs">
                                        {challenge.challengeRecordValue}
                                    </code>
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {domains.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No sending domains configured.
                        </p>
                    ) : (
                        <div className="overflow-hidden rounded-lg border">
                            {domains.map((item) => (
                                <div
                                    key={item.domainId}
                                    className="flex flex-wrap items-center gap-3 border-b p-3 last:border-b-0"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">
                                            {item.domain}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {item.lastCheckedAt
                                                ? `Checked ${new Date(item.lastCheckedAt).toLocaleDateString()}`
                                                : "Not checked yet"}
                                        </p>
                                    </div>
                                    <Badge
                                        variant={
                                            item.status === "verified"
                                                ? "success"
                                                : item.status === "revoked"
                                                  ? "destructive"
                                                  : "secondary"
                                        }
                                    >
                                        {item.status}
                                    </Badge>
                                    {item.status !== "revoked" ? (
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={saving}
                                                onClick={() =>
                                                    void verify(item.domainId)
                                                }
                                            >
                                                Verify
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={saving}
                                                onClick={() =>
                                                    setRevoking(item)
                                                }
                                            >
                                                Revoke
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add sending domain</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="sending-domain">Domain</Label>
                        <Input
                            id="sending-domain"
                            value={domain}
                            onChange={(event) => setDomain(event.target.value)}
                            placeholder="example.com"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            disabled={saving || !domain.trim()}
                            onClick={() => void addDomain()}
                        >
                            {saving ? "Creating…" : "Create challenge"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <AlertDialog
                open={Boolean(revoking)}
                onOpenChange={(value) => !value && setRevoking(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Revoke sending domain?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            New sends from {revoking?.domain} will require
                            another verified domain.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={saving}
                            onClick={(event) => {
                                event.preventDefault();
                                void revoke();
                            }}
                        >
                            Revoke domain
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function TeamsAndGrantsSection({
    organizationId,
    teams,
    esps,
    grants,
    loading,
    billing,
    onUpgradeParent,
    onChanged,
}: {
    organizationId: string;
    teams: OrganizationTeam[];
    esps: EspConfig[];
    grants: Record<string, OrganizationEspGrant | null>;
    loading: boolean;
    billing: OrganizationBilling | null;
    onUpgradeParent: () => void;
    onChanged: () => Promise<void>;
}) {
    const [newTeamOpen, setNewTeamOpen] = useState(false);
    const activeTeams = teams.filter((team) => team.status !== "archived");
    const teamLimitReached = Boolean(
        billing?.entitlements.teamsLimit !== null &&
        billing?.entitlements.teamsLimit !== undefined &&
        billing.usage.teams >= billing.entitlements.teamsLimit,
    );
    const sharedMailboxEnabled =
        billing === null || billing.entitlements.sharedOrganizationMailbox;
    return (
        <Card>
            <OrganizationSectionHeader
                title="Teams and mailbox sharing"
                description="Each team can receive one active shared ESP grant. Members see a sending option, never mailbox credentials."
                action={
                    <>
                        <Button
                            onClick={() => setNewTeamOpen(true)}
                            disabled={teamLimitReached}
                        >
                            <Plus className="size-4" />
                            New team
                        </Button>
                    </>
                }
            />
            <CardContent>
                {billing?.pendingPlanChange ? (
                    <Banner className="mb-4" variant="success">
                        Plan change to{" "}
                        {PLAN_LABELS[billing.pendingPlanChange.targetPlan]} (
                        {billing.pendingPlanChange.targetInterval === "month"
                            ? "monthly"
                            : "yearly"}
                        ) is{" "}
                        {billing.pendingPlanChange.effectiveAt === "immediately"
                            ? "being confirmed"
                            : "scheduled for the next billing date"}
                        .
                    </Banner>
                ) : null}
                {teamLimitReached ? (
                    <Banner className="mb-4">
                        This organization has reached its{" "}
                        {billing?.entitlements.teamsLimit}-team limit. Upgrade
                        to add another team.
                    </Banner>
                ) : null}
                {billing &&
                billing.entitlements.teamsLimit !== null &&
                !teamLimitReached ? (
                    <p className="mb-4 text-xs text-muted-foreground">
                        {billing.usage.teams} of{" "}
                        {billing.entitlements.teamsLimit} teams used.
                    </p>
                ) : null}
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
                                sharedMailboxEnabled={sharedMailboxEnabled}
                                onUpgradeParent={onUpgradeParent}
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

function OrganizationBillingDialog({
    organizationId,
    billing,
    open,
    onOpenChange,
}: {
    organizationId: string;
    billing: OrganizationBilling | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
    const [plan, setPlan] = useState<"pro" | "business">("pro");
    const [interval, setInterval] = useState<"month" | "year">("month");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setCatalog(null);
        void (async () => {
            try {
                setCatalog(await getBillingCatalog());
            } catch (err) {
                setError(errorMessage(err, "Unable to load billing plans"));
            }
        })();
    }, [open]);

    const offer = catalog?.offers.find(
        (item) => item.plan === plan && item.interval === interval,
    );

    async function checkout() {
        if (!catalog?.catalogRevision || !offer) return;
        setLoading(true);
        setError(null);
        try {
            const result = await createOrganizationBillingCheckout(
                organizationId,
                { plan, interval, catalogRevision: catalog.catalogRevision },
            );
            window.location.assign(result.checkoutUrl);
        } catch (err) {
            setError(errorMessage(err, "Unable to start checkout"));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[600px] overflow-hidden p-0">
                <div className="border-b bg-gradient-to-br from-[var(--primary-soft)] via-card to-card px-6 pt-7 pb-6">
                    <DialogHeader className="gap-4 pr-6">
                        <div className="flex items-start gap-3.5">
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
                                <Sparkles className="size-5" />
                            </div>
                            <div className="space-y-1">
                                <DialogTitle className="text-xl tracking-tight">
                                    Upgrade organization
                                </DialogTitle>
                                <DialogDescription className="max-w-[440px] leading-relaxed">
                                    Unlock more room to grow while keeping
                                    billing neatly scoped to this organization.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <div className="space-y-5 px-6 py-6">
                    {error ? <Banner>{error}</Banner> : null}
                    {!catalog ? (
                        error ? (
                            <div className="rounded-[var(--radius-lg)] border border-dashed p-4 text-sm text-muted-foreground">
                                Close this dialog and try again once billing
                                plans are available.
                            </div>
                        ) : (
                            <Loading />
                        )
                    ) : (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        Plan
                                    </Label>
                                    <Select
                                        value={plan}
                                        onValueChange={(value) =>
                                            setPlan(value as "pro" | "business")
                                        }
                                    >
                                        <SelectTrigger className="h-11 bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pro">
                                                Pro
                                            </SelectItem>
                                            <SelectItem value="business">
                                                Business
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        Billing interval
                                    </Label>
                                    <Select
                                        value={interval}
                                        onValueChange={(value) =>
                                            setInterval(
                                                value as "month" | "year",
                                            )
                                        }
                                    >
                                        <SelectTrigger className="h-11 bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="month">
                                                Monthly
                                            </SelectItem>
                                            <SelectItem value="year">
                                                Yearly (2 months free)
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {offer ? (
                                <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-primary/15 bg-[var(--primary-soft)] p-4">
                                    <div className="absolute -top-10 -right-8 size-28 rounded-full bg-primary/10 blur-2xl" />
                                    <div className="relative flex items-start justify-between gap-4">
                                        <div className="space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-semibold">
                                                    {plan === "pro"
                                                        ? "Pro workspace"
                                                        : "Business workspace"}
                                                </p>
                                                {plan === "pro" ? (
                                                    <Badge variant="success">
                                                        Most popular
                                                    </Badge>
                                                ) : null}
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {plan === "pro"
                                                    ? "5 teams · 10,000 subscribed contacts"
                                                    : "25 teams · unlimited subscribed contacts"}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-2xl font-semibold tracking-tight tabular-nums">
                                                {formatMinorAmount(
                                                    offer.amountMinor,
                                                    offer.currency,
                                                )}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                per{" "}
                                                {interval === "month"
                                                    ? "month"
                                                    : "year"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="relative mt-4 flex items-center gap-2 border-t border-primary/15 pt-3 text-xs text-muted-foreground">
                                        <ShieldCheck className="size-4 shrink-0 text-primary" />
                                        <span>
                                            {offer.trialDays
                                                ? `${offer.trialDays}-day trial included · hosted secure checkout`
                                                : "Hosted secure checkout · change plan in SendLit; manage cards and cancellation in billing"}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[var(--radius-lg)] border border-dashed p-4 text-sm text-muted-foreground">
                                    Choose a plan and billing interval to see
                                    the current price.
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="mt-0 flex-col items-stretch gap-3 border-t bg-muted/25 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="size-4 text-primary" />
                        <span>Secure payment handled by Dodo</span>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                        <Button
                            className="flex-1 sm:flex-none"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="flex-1 sm:min-w-[190px] sm:flex-none"
                            size="lg"
                            onClick={() => void checkout()}
                            disabled={
                                loading || !offer || !catalog?.checkoutAvailable
                            }
                        >
                            {loading
                                ? "Opening checkout…"
                                : "Continue to checkout"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OrganizationPlanChangeDialog({
    organizationId,
    billing,
    open,
    onOpenChange,
    onChanged,
}: {
    organizationId: string;
    billing: OrganizationBilling;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChanged: () => Promise<void>;
}) {
    const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
    const [plan, setPlan] = useState<"pro" | "business">(
        billing.plan === "business" ? "business" : "pro",
    );
    const [interval, setInterval] = useState<"month" | "year">(
        billing.billingInterval ?? "month",
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setPlan(billing.plan === "business" ? "business" : "pro");
        setInterval(billing.billingInterval ?? "month");
        setError(null);
        setCatalog(null);
        void (async () => {
            try {
                setCatalog(await getBillingCatalog());
            } catch (err) {
                setError(errorMessage(err, "Unable to load billing plans"));
            }
        })();
    }, [open, billing.plan, billing.billingInterval]);

    const offer = catalog?.offers.find(
        (item) => item.plan === plan && item.interval === interval,
    );
    const unchanged =
        billing.plan === plan && billing.billingInterval === interval;
    const isUpgrade =
        (plan === "business" && billing.plan === "pro") ||
        (plan === billing.plan &&
            billing.billingInterval === "month" &&
            interval === "year");

    async function submit() {
        if (!catalog?.catalogRevision || !offer || unchanged) return;
        setLoading(true);
        setError(null);
        try {
            const result: OrganizationPlanChange =
                await createOrganizationBillingPlanChange(organizationId, {
                    plan,
                    interval,
                    catalogRevision: catalog.catalogRevision,
                });
            if (result.paymentUrl) {
                window.location.assign(result.paymentUrl);
                return;
            }
            onOpenChange(false);
            toast.success(
                result.effectiveAt === "immediately"
                    ? "Plan change requested. We’ll enable it when the payment provider confirms it."
                    : "Plan change scheduled for the next billing date.",
            );
            await onChanged();
        } catch (err) {
            setError(errorMessage(err, "Unable to change plan"));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[600px] overflow-hidden p-0">
                <div className="border-b bg-gradient-to-br from-[var(--primary-soft)] via-card to-card px-6 pt-7 pb-6">
                    <DialogHeader className="gap-2 pr-6">
                        <div className="flex items-start gap-3.5">
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
                                <Sparkles className="size-5" />
                            </div>
                            <div className="space-y-1">
                                <DialogTitle className="text-xl tracking-tight">
                                    Change organization plan
                                </DialogTitle>
                                <DialogDescription className="leading-relaxed">
                                    Choose the plan and billing interval for
                                    this organization. SendLit will apply the
                                    change and confirm it from the provider
                                    webhook.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>
                <div className="space-y-5 px-6 py-6">
                    {error ? <Banner>{error}</Banner> : null}
                    {!catalog ? (
                        error ? (
                            <div className="rounded-[var(--radius-lg)] border border-dashed p-4 text-sm text-muted-foreground">
                                Close this dialog and try again once billing
                                plans are available.
                            </div>
                        ) : (
                            <Loading />
                        )
                    ) : (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        Plan
                                    </Label>
                                    <Select
                                        value={plan}
                                        onValueChange={(value) =>
                                            setPlan(value as "pro" | "business")
                                        }
                                    >
                                        <SelectTrigger className="h-11 bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pro">
                                                Pro
                                            </SelectItem>
                                            <SelectItem value="business">
                                                Business
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        Billing interval
                                    </Label>
                                    <Select
                                        value={interval}
                                        onValueChange={(value) =>
                                            setInterval(
                                                value as "month" | "year",
                                            )
                                        }
                                    >
                                        <SelectTrigger className="h-11 bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="month">
                                                Monthly
                                            </SelectItem>
                                            <SelectItem value="year">
                                                Yearly (2 months free)
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {offer ? (
                                <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-primary/15 bg-[var(--primary-soft)] p-4">
                                    <div className="relative flex items-start justify-between gap-4">
                                        <div className="space-y-1.5">
                                            <p className="text-sm font-semibold">
                                                {plan === "pro"
                                                    ? "Pro workspace"
                                                    : "Business workspace"}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {plan === "pro"
                                                    ? "5 teams · 10,000 subscribed contacts"
                                                    : "25 teams · unlimited subscribed contacts"}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-2xl font-semibold tracking-tight tabular-nums">
                                                {formatMinorAmount(
                                                    offer.amountMinor,
                                                    offer.currency,
                                                )}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                per{" "}
                                                {interval === "month"
                                                    ? "month"
                                                    : "year"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="relative mt-4 flex items-center gap-2 border-t border-primary/15 pt-3 text-xs text-muted-foreground">
                                        <ShieldCheck className="size-4 shrink-0 text-primary" />
                                        <span>
                                            {unchanged
                                                ? "This is your current plan."
                                                : isUpgrade
                                                  ? "Takes effect immediately; any prorated charge is handled securely by the payment provider."
                                                  : "Takes effect at the next billing date; your current entitlements remain available until then."}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[var(--radius-lg)] border border-dashed p-4 text-sm text-muted-foreground">
                                    Choose a plan and billing interval to see
                                    the current price.
                                </div>
                            )}
                        </>
                    )}
                </div>
                <DialogFooter className="mt-0 flex-col items-stretch gap-3 border-t bg-muted/25 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                        className="sm:w-auto"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        className="sm:min-w-[190px]"
                        size="lg"
                        onClick={() => void submit()}
                        disabled={
                            loading ||
                            !offer ||
                            unchanged ||
                            !catalog?.checkoutAvailable
                        }
                    >
                        {loading ? "Updating plan…" : "Confirm plan change"}
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
    sharedMailboxEnabled,
    onUpgradeParent,
    onChanged,
}: {
    organizationId: string;
    team: OrganizationTeam;
    esps: EspConfig[];
    grant: OrganizationEspGrant | null;
    sharedMailboxEnabled: boolean;
    onUpgradeParent: () => void;
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
                    <DropdownMenuItem onSelect={() => onUpgradeParent()}>
                        <Sparkles />
                        Upgrade parent organization
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={archived || !sharedMailboxEnabled}
                        onSelect={() => setGrantEditorOpen(true)}
                    >
                        <Mail />
                        {sharedMailboxEnabled
                            ? "Mailbox grant settings"
                            : "Mailbox grant settings (upgrade required)"}
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
            <OrganizationSectionHeader
                title="Organization members"
                description={
                    <>
                        Organization access is separate from team membership and
                        never grants access to a team&apos;s contacts or
                        content.
                    </>
                }
                action={
                    <Button onClick={() => setOpen(true)}>
                        <Plus className="size-4" />
                        Add existing user
                    </Button>
                }
            />
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
                    <OrganizationSectionHeader
                        title="Shared-delivery usage"
                        description="Only organization-delivery sends count toward this pool."
                    />
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
                    <OrganizationSectionHeader
                        title="Recent audit activity"
                        description="The latest 50 secret-free organization administration events."
                    />
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
                <OrganizationSectionHeader
                    title="Transactional mail activity"
                    description="Counts are transactional only. Shared-delivery quota remains separate. No email content is shown."
                    action={
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
                    }
                />
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
    billing,
    onChanged,
}: {
    organizationId: string;
    keys: OrganizationApiKey[];
    loading: boolean;
    billing: OrganizationBilling | null;
    onChanged: () => Promise<void>;
}) {
    const [newKeyOpen, setNewKeyOpen] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const keysEnabled =
        billing === null || billing.entitlements.organizationApiKeys;
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
            <OrganizationSectionHeader
                title="Organization API keys"
                description={
                    <>
                        Use scoped keys for server-to-server provisioning.
                        Secrets are shown once and are never stored in the
                        browser.
                    </>
                }
                action={
                    <Button
                        type="button"
                        onClick={() => setNewKeyOpen(true)}
                        disabled={!keysEnabled}
                    >
                        <Plus className="size-4" />
                        New key
                    </Button>
                }
            />
            <CardContent>
                {!keysEnabled ? (
                    <Banner className="mb-4">
                        Organization API keys are available on Business and OSS.
                        Upgrade this organization to create one.
                    </Banner>
                ) : null}
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
