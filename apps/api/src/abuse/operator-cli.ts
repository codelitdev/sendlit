import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  organizationPlanPolicies,
  organizations,
  teamSendingControls,
  teams,
  user,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "../organization/audit";
import {
  getAbuseFlag,
  listAbuseFlags,
  resolveAbuseFlag,
  setOrganizationSuspended,
} from "./flags";

export const ABUSE_CLI_USAGE = `Usage: bun scripts/abuse.ts <command>

  queue [--all]                       Open flags (signups, held emails, large
                                      imports, first large broadcasts),
                                      suspended organizations and paused
                                      teams. --all includes closed flags.
  show <flagId>                       One flag with its details.
  release <flagId> --operator <userId> --reason <text>
                                      Not abuse: approve the email, lift the
                                      import hold, let the organization send
                                      large broadcasts, release teams paused
                                      for it.
  confirm <flagId> --operator <userId> --reason <text>
                                      Abuse: suspend the organization's sending.
  suspend-org <organizationId> --operator <userId> --reason <text>
  unsuspend-org <organizationId> --operator <userId> --reason <text>
  pacing-exempt <organizationId> on|off --operator <userId> --reason <text>
                                      Vetted organization: no new-account ramp,
                                      pacing or first-broadcast review.`;

class UsageError extends Error {}

function option(args: string[], name: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new UsageError(`--${name} is required`);
  return value;
}

async function operatorId(args: string[]): Promise<string> {
  const id = option(args, "operator");
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  if (!row) throw new Error("operator_user_not_found");
  return id;
}

async function organizationByPublicId(publicId: string) {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.organizationId, publicId))
    .limit(1);
  if (!row) throw new Error("organization_not_found");
  return row;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export async function runAbuseCli(
  argv: string[],
  io: { out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "queue": {
        const flags = await listAbuseFlags(args.includes("--all") ? "all" : "open");
        const suspended = await db
          .select({
            organizationId: organizations.organizationId,
            name: organizations.name,
          })
          .from(organizations)
          .where(eq(organizations.status, "suspended"));
        const paused = await db
          .select({
            teamId: teams.teamId,
            team: teams.name,
            organizationId: organizations.organizationId,
            status: teamSendingControls.status,
            reason: teamSendingControls.reasonCode,
            source: teamSendingControls.source,
          })
          .from(teamSendingControls)
          .innerJoin(teams, eq(teams.id, teamSendingControls.teamId))
          .innerJoin(organizations, eq(organizations.id, teams.organizationId))
          .where(
            inArray(teamSendingControls.status, ["all_paused", "marketing_paused"]),
          );
        io.out(
          json({
            flags: flags.map(({ flag, organizationPublicId, organizationName }) => ({
              flagId: flag.flagId,
              kind: flag.kind,
              severity: flag.severity,
              status: flag.status,
              organization: `${organizationName} (${organizationPublicId})`,
              reason: flag.reason,
              createdAt: flag.createdAt.toISOString(),
            })),
            suspendedOrganizations: suspended,
            pausedTeams: paused,
          }),
        );
        return 0;
      }
      case "show": {
        const flag = await getAbuseFlag(args[0] ?? "");
        if (!flag) throw new Error("flag_not_found");
        io.out(json(flag));
        return 0;
      }
      case "release":
      case "confirm": {
        const flagId = args[0];
        if (!flagId) throw new UsageError("flag id required");
        const updated = await resolveAbuseFlag({
          flagId,
          resolution: command === "release" ? "released" : "confirmed",
          operatorUserId: await operatorId(args),
          note: option(args, "reason"),
        });
        if (!updated) throw new Error("flag_not_found_or_closed");
        io.out(json({ flagId: updated.flagId, status: updated.status }));
        return 0;
      }
      case "suspend-org":
      case "unsuspend-org": {
        const organization = await organizationByPublicId(args[0] ?? "");
        option(args, "reason");
        const changed = await setOrganizationSuspended(
          organization.id,
          command === "suspend-org",
          await operatorId(args),
        );
        io.out(json({ organizationId: organization.organizationId, changed }));
        return 0;
      }
      case "pacing-exempt": {
        const organization = await organizationByPublicId(args[0] ?? "");
        const value = args[1];
        if (value !== "on" && value !== "off") throw new UsageError("on or off");
        const operator = await operatorId(args);
        const reason = option(args, "reason");
        await db.transaction(async (tx) => {
          await tx
            .insert(organizationPlanPolicies)
            .values({ organizationId: organization.id, pacingExempt: value === "on" })
            .onConflictDoUpdate({
              target: organizationPlanPolicies.organizationId,
              set: { pacingExempt: value === "on", updatedAt: new Date() },
            });
          await recordOrganizationAuditEvent(tx, {
            organizationId: organization.id,
            actor: { type: "user", id: operator },
            action: "organization.pacing_exempt_changed",
            metadata: { exempt: value === "on", reason },
          });
        });
        io.out(
          json({
            organizationId: organization.organizationId,
            pacingExempt: value === "on",
          }),
        );
        return 0;
      }
      default:
        throw new UsageError("unknown command");
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\n${ABUSE_CLI_USAGE}`);
      return 2;
    }
    io.err(`error: ${(error as Error).message}`);
    return 1;
  }
}
