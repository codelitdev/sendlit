"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { ApiError } from "@/lib/api-client";
import {
    createTeam,
    createTeamKey,
    deleteTeam,
    deleteTeamKey,
    listTeamKeys,
    listTeams,
    type ApiKey,
    type Team,
} from "@/lib/api";
import { resolveCurrentTeamId } from "@/lib/tokens";

export default function TeamsPage() {
    const [teams, setTeams] = useState<Team[] | undefined>(undefined);
    const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            const { items } = await listTeams();
            setTeams(items);
            setCurrentTeamId(resolveCurrentTeamId(items));
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to load teams",
            );
            setTeams([]);
        }
    }

    useEffect(() => {
        load();
    }, []);

    if (teams === undefined) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    return (
        <ScrollablePage>
            <div className="max-w-3xl">
                <PageHeader
                    title="Teams"
                    description="Everything — contacts, templates, broadcasts, sequences, ESP config, API keys — is scoped to a team. Create as many as you need; switch between them any time."
                    action={<CreateTeamDialog onCreated={load} />}
                />

                {error && <Banner className="mb-4">{error}</Banner>}

                <div className="space-y-4">
                    {teams.map((team) => (
                        <TeamCard
                            key={team.teamId}
                            team={team}
                            isCurrent={team.teamId === currentTeamId}
                            onChanged={load}
                        />
                    ))}
                </div>
            </div>
        </ScrollablePage>
    );
}

function CreateTeamDialog({ onCreated }: { onCreated: () => void }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function submit() {
        if (!name.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const team = await createTeam(name.trim());
            setOpen(false);
            setName("");
            onCreated();
            // Switch straight into the team that was just created.
            const form = document.createElement("form");
            form.method = "POST";
            form.action = "/api/team/switch";
            form.innerHTML = `<input type="hidden" name="teamId" value="${team.teamId}"><input type="hidden" name="redirectTo" value="/teams">`;
            document.body.appendChild(form);
            form.submit();
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to create team",
            );
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    New team
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New team</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {error && <Banner>{error}</Banner>}
                    <div className="space-y-1.5">
                        <Label htmlFor="team-name">Name</Label>
                        <Input
                            id="team-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Acme Newsletter"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        onClick={submit}
                        disabled={!name.trim() || submitting}
                    >
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function TeamCard({
    team,
    isCurrent,
    onChanged,
}: {
    team: Team;
    isCurrent: boolean;
    onChanged: () => void;
}) {
    const [showKeys, setShowKeys] = useState(false);
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [keysLoaded, setKeysLoaded] = useState(false);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [newKeyName, setNewKeyName] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function loadKeys() {
        try {
            const { items } = await listTeamKeys(team.teamId);
            setKeys(items);
            setKeysLoaded(true);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to load API keys",
            );
        }
    }

    function toggleKeys() {
        const next = !showKeys;
        setShowKeys(next);
        if (next && !keysLoaded) loadKeys();
    }

    async function addKey() {
        if (!newKeyName.trim()) return;
        try {
            const created = await createTeamKey(team.teamId, newKeyName.trim());
            setNewKey(created.key);
            setNewKeyName("");
            await loadKeys();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to create API key",
            );
        }
    }

    async function removeKey(key: string) {
        try {
            await deleteTeamKey(team.teamId, key);
            await loadKeys();
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? err.message
                    : "Failed to delete API key",
            );
        }
    }

    async function removeTeam() {
        if (
            !confirm(
                `Delete "${team.name}"? This deletes everything scoped to it — contacts, templates, broadcasts, sequences.`,
            )
        ) {
            return;
        }
        try {
            await deleteTeam(team.teamId);
            onChanged();
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : "Failed to delete team",
            );
        }
    }

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                    {team.name}
                    {isCurrent && <Badge variant="success">Current</Badge>}
                </CardTitle>
                {!isCurrent && (
                    <form action="/api/team/switch" method="POST">
                        <input
                            type="hidden"
                            name="teamId"
                            value={team.teamId}
                        />
                        <input type="hidden" name="redirectTo" value="/teams" />
                        <Button type="submit" variant="outline" size="sm">
                            Switch to this team
                        </Button>
                    </form>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                {error && <Banner>{error}</Banner>}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleKeys}
                    className="gap-1.5 px-0"
                >
                    <KeyRound className="size-4" />
                    {showKeys ? "Hide API keys" : "Manage API keys"}
                </Button>

                {showKeys && (
                    <div className="space-y-3 rounded-md border p-3">
                        {keys.length === 0 && keysLoaded && (
                            <p className="text-sm text-muted-foreground">
                                No API keys yet.
                            </p>
                        )}
                        {newKey && (
                            <Banner variant="success">
                                <div className="space-y-2">
                                    <p>
                                        New key created. Copy it now; it will
                                        not be shown again.
                                    </p>
                                    <div className="flex items-center gap-2 rounded-md bg-background p-2 font-mono text-xs">
                                        <span className="min-w-0 flex-1 truncate">
                                            {newKey}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                navigator.clipboard.writeText(
                                                    newKey,
                                                )
                                            }
                                        >
                                            <Copy className="size-3" />
                                            Copy
                                        </Button>
                                    </div>
                                </div>
                            </Banner>
                        )}
                        {keys.map((k) => (
                            <div
                                key={k.id}
                                className="flex items-center justify-between gap-2 text-sm"
                            >
                                <div className="min-w-0">
                                    <div className="font-medium">
                                        {k.name || "Untitled"}
                                    </div>
                                    <div className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                                        {k.keyPrefix}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                navigator.clipboard.writeText(
                                                    k.keyPrefix,
                                                )
                                            }
                                            className="shrink-0"
                                            title="Copy"
                                        >
                                            <Copy className="size-3" />
                                        </button>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="shrink-0 text-destructive"
                                    onClick={() => removeKey(k.id)}
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        ))}
                        <div className="flex gap-2">
                            <Input
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="e.g. CourseLit integration"
                                className="h-8"
                            />
                            <Button
                                size="sm"
                                onClick={addKey}
                                disabled={!newKeyName.trim()}
                            >
                                <Plus className="size-4" />
                                Create key
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
            <CardFooter>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={removeTeam}
                >
                    <Trash2 className="size-4" />
                    Delete team
                </Button>
            </CardFooter>
        </Card>
    );
}
