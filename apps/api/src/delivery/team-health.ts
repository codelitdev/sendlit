import { and, inArray, isNull, ne, or } from "drizzle-orm";
import { ledgerCounts } from "../billing/reputation";
import { CONTROL_RANK, type ControlStatus } from "../billing/reputation-policy";
import { db } from "../db/client";
import {
  espConfigTeamGrants,
  sharedEspSendingControls,
  teamSendingControls,
} from "../db/schema";
import { readSharedEspGuardConfig } from "./shared-esp-policy";

export type TeamHealth = {
  /** The strictest control on the team: its own reputation control or the
   * shared mailbox's guard, for the team or the whole mailbox. */
  status: ControlStatus;
  reason: string | null;
  /** Where `status` comes from; null while it is `normal`. */
  scope: "team" | "shared_mailbox" | null;
  /** Emails the ESP accepted in the last 7 days, and how many of them
   * bounced or were marked as spam. */
  last7Days: { sent: number; bounced: number; complained: number };
};

function healthy(): TeamHealth {
  return {
    status: "normal",
    reason: null,
    scope: null,
    last7Days: { sent: 0, bounced: 0, complained: 0 },
  };
}

/** Health for several teams (by internal id) in a fixed number of queries. */
export async function getTeamsHealth(
  teamIds: string[],
  now = new Date(),
): Promise<Map<string, TeamHealth>> {
  const result = new Map<string, TeamHealth>();
  for (const id of teamIds) result.set(id, healthy());
  if (teamIds.length === 0) return result;

  // Every delivery source counts: this is the team's whole sending health.
  const metrics = await ledgerCounts({ now, teamIds });
  for (const row of metrics) {
    const health = result.get(row.teamId);
    if (!health) continue;
    health.last7Days = {
      sent: row.accepted,
      bounced: row.bounced,
      complained: row.complained,
    };
  }

  const raise = (
    teamId: string,
    status: string,
    reason: string | null,
    scope: "team" | "shared_mailbox",
  ) => {
    const health = result.get(teamId);
    const next = status as ControlStatus;
    if (
      !health ||
      !(next in CONTROL_RANK) ||
      CONTROL_RANK[next] <= CONTROL_RANK[health.status]
    )
      return;
    health.status = next;
    health.reason = reason;
    health.scope = scope;
  };

  const teamControls = await db
    .select({
      teamId: teamSendingControls.teamId,
      status: teamSendingControls.status,
      reason: teamSendingControls.reasonCode,
    })
    .from(teamSendingControls)
    .where(inArray(teamSendingControls.teamId, teamIds));
  for (const control of teamControls) {
    raise(control.teamId, control.status, control.reason, "team");
  }

  // Shared-mailbox controls only block sends while the guard is on, so
  // they only count towards health then too.
  if (readSharedEspGuardConfig().enabled) {
    const grants = await db
      .select({
        teamId: espConfigTeamGrants.teamId,
        espConfigId: espConfigTeamGrants.espConfigId,
      })
      .from(espConfigTeamGrants)
      .where(
        and(
          inArray(espConfigTeamGrants.teamId, teamIds),
          ne(espConfigTeamGrants.status, "revoked"),
        ),
      );
    if (grants.length > 0) {
      const controls = await db
        .select({
          espConfigId: sharedEspSendingControls.espConfigId,
          teamId: sharedEspSendingControls.teamId,
          status: sharedEspSendingControls.status,
          reason: sharedEspSendingControls.reasonCode,
        })
        .from(sharedEspSendingControls)
        .where(
          and(
            inArray(
              sharedEspSendingControls.espConfigId,
              grants.map((grant) => grant.espConfigId),
            ),
            or(
              isNull(sharedEspSendingControls.teamId),
              inArray(sharedEspSendingControls.teamId, teamIds),
            ),
          ),
        );
      for (const grant of grants) {
        for (const control of controls) {
          if (control.espConfigId !== grant.espConfigId) continue;
          if (control.teamId !== null && control.teamId !== grant.teamId) continue;
          // A mailbox-wide warning isn't this team's doing; only a
          // mailbox-wide pause stops its marketing.
          if (control.teamId === null && control.status !== "marketing_paused")
            continue;
          raise(
            grant.teamId,
            control.status,
            control.reason,
            control.teamId ? "team" : "shared_mailbox",
          );
        }
      }
    }
  }
  return result;
}

export async function getTeamHealth(teamId: string, now = new Date()) {
  return (await getTeamsHealth([teamId], now)).get(teamId) ?? healthy();
}
