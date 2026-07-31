import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    espConfigTeamGrants,
    espConfigs,
    organizationAuditEvents,
    teams,
} from "../db/schema";

/** Keep audit writes explicit and secret-free. Callers normally pass their
 * surrounding transaction so the recorded action cannot diverge from state. */
export async function recordOrganizationAuditEvent(
    tx: any,
    input: {
        organizationId: string;
        actor: {
            type: "user" | "organization_key" | "team_key" | "system";
            id?: string | null;
        };
        action: string;
        teamId?: string | null;
        espConfigId?: string | null;
        espGrantId?: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    await tx.insert(organizationAuditEvents).values({
        organizationId: input.organizationId,
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        action: input.action,
        teamId: input.teamId ?? null,
        espConfigId: input.espConfigId ?? null,
        espGrantId: input.espGrantId ?? null,
        metadata: input.metadata ?? {},
    });
}

/** A deliberately redacted audit projection for organization administrators.
 * It preserves public resource references and useful metadata, but never
 * leaks internal IDs, key hashes, or provider credentials. */
export async function listOrganizationAuditEvents(organizationId: string) {
    const rows = await db
        .select({
            event: organizationAuditEvents,
            teamId: teams.teamId,
            espId: espConfigs.espId,
            grantId: espConfigTeamGrants.grantId,
        })
        .from(organizationAuditEvents)
        .leftJoin(teams, eq(teams.id, organizationAuditEvents.teamId))
        .leftJoin(
            espConfigs,
            eq(espConfigs.id, organizationAuditEvents.espConfigId),
        )
        .leftJoin(
            espConfigTeamGrants,
            eq(espConfigTeamGrants.id, organizationAuditEvents.espGrantId),
        )
        .where(eq(organizationAuditEvents.organizationId, organizationId))
        .orderBy(desc(organizationAuditEvents.createdAt))
        .limit(50);
    return rows.map((row) => ({
        action: row.event.action,
        actorType: row.event.actorType as
            "user" | "organization_key" | "team_key" | "system",
        teamId: row.teamId ?? null,
        espId: row.espId ?? null,
        grantId: row.grantId ?? null,
        metadata: row.event.metadata as Record<string, unknown>,
        createdAt: row.event.createdAt,
    }));
}
