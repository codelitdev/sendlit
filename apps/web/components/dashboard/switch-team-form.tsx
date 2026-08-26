"use client";

import type { ReactNode } from "react";
import { selectOrganizationContext } from "@/lib/tokens";

function applyOrganizationContext(organizationId?: string) {
    if (organizationId) selectOrganizationContext(organizationId);
}

/** Shared team-switch POST. The dashboard shell keys the active team off
 * both cookies, so omitting `organizationId` lets the sidebar snap back to
 * the previous organization after this form lands. */
export function SwitchTeamForm({
    teamId,
    organizationId,
    redirectTo = "/",
    className,
    children,
}: {
    teamId: string;
    organizationId?: string;
    redirectTo?: string;
    className?: string;
    children: ReactNode;
}) {
    function onSubmit() {
        applyOrganizationContext(organizationId);
    }

    return (
        <form
            action="/api/team/switch"
            method="POST"
            className={className}
            onSubmit={onSubmit}
        >
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            {organizationId ? (
                <input
                    type="hidden"
                    name="organizationId"
                    value={organizationId}
                />
            ) : null}
            {children}
        </form>
    );
}

/** Programmatic equivalent of `SwitchTeamForm` for flows that create a team
 * and then immediately enter it. */
export function submitTeamSwitch({
    teamId,
    organizationId,
    redirectTo = "/",
}: {
    teamId: string;
    organizationId?: string;
    redirectTo?: string;
}) {
    applyOrganizationContext(organizationId);
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/team/switch";
    const fields: Record<string, string> = { teamId, redirectTo };
    if (organizationId) fields.organizationId = organizationId;
    for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
}
