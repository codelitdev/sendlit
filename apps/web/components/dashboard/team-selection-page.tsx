"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/codelit/button";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/codelit/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Banner } from "@/components/dashboard/banner";
import { Loading } from "@/components/dashboard/loading";
import { ScrollablePage } from "@/components/dashboard/scrollable-page";
import { useSetBreadcrumb } from "@/components/dashboard/breadcrumb-context";
import { ApiError } from "@/lib/api-client";
import { createTeam, listTeams, type Team } from "@/lib/api";
import { resolveCurrentTeamId } from "@/lib/tokens";

export function TeamSelectionPage() {
    useSetBreadcrumb([{ label: "Choose a team" }]);
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
        void load();
    }, []);

    if (teams === undefined) return <Loading />;

    return (
        <ScrollablePage>
            <div className="w-full">
                <PageHeader
                    title="Choose a team"
                    description="Select the workspace you want to work in."
                />

                {error && <Banner className="mb-4">{error}</Banner>}

                {teams.length === 0 ? (
                    <Card className="mx-auto mt-8 max-w-2xl">
                        <CardContent className="flex flex-col items-center px-6 py-10 text-center sm:px-12 sm:py-12">
                            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-primary ring-1 ring-primary/10">
                                <Users className="size-7" />
                            </div>
                            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-primary">
                                <CheckCircle2 className="size-3.5" />
                                Organization ready
                            </div>
                            <h2 className="text-xl font-semibold tracking-tight">
                                Create your first team
                            </h2>
                            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                                Give your email workspace a name. Your contacts,
                                content, campaigns, and delivery configuration
                                will live here.
                            </p>
                            <div className="mt-6">
                                <CreateTeamDialog
                                    onCreated={load}
                                    label="Create your first team"
                                    size="lg"
                                />
                            </div>
                            <p className="mt-4 text-xs text-muted-foreground">
                                You can create and switch between additional
                                teams later.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {teams.map((team) => (
                            <TeamCard
                                key={team.teamId}
                                team={team}
                                isCurrent={team.teamId === currentTeamId}
                            />
                        ))}
                    </div>
                )}
            </div>
        </ScrollablePage>
    );
}

function CreateTeamDialog({
    onCreated,
    label = "New team",
    size = "md",
}: {
    onCreated: () => void;
    label?: string;
    size?: "sm" | "md" | "lg";
}) {
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
            const form = document.createElement("form");
            form.method = "POST";
            form.action = "/api/team/switch";
            form.innerHTML = `<input type="hidden" name="teamId" value="${team.teamId}"><input type="hidden" name="redirectTo" value="/">`;
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
                <Button size={size}>
                    <Plus className="size-4" />
                    {label}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New team</DialogTitle>
                    <DialogDescription>
                        Choose a name for the workspace that will hold your
                        email operation.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {error && <Banner>{error}</Banner>}
                    <div className="space-y-1.5">
                        <Label htmlFor="team-name">Name</Label>
                        <Input
                            id="team-name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="e.g. Acme Newsletter"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        onClick={submit}
                        disabled={!name.trim() || submitting}
                    >
                        {submitting ? "Creating…" : "Create team"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function TeamCard({ team, isCurrent }: { team: Team; isCurrent: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
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
                        <input type="hidden" name="redirectTo" value="/" />
                        <Button type="submit" variant="outline" size="sm">
                            Switch to this team
                        </Button>
                    </form>
                )}
            </CardHeader>
        </Card>
    );
}
