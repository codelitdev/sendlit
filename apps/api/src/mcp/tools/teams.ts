import { billingPlanSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { createApiKey, deleteApiKey, getApiKeysByTeamId } from "../../apikey/queries";
import { getOrganizationMembership } from "../../organization/queries";
import {
  archiveTeam,
  createTeam,
  getTeam,
  getTeamByTeamId,
  getTeamMembership,
  listTeamViewsForUser,
  renameTeam,
} from "../../team/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { isPlanGateError, notFound, planGateError, toolError } from "./responses";
import {
  apiKeySchema,
  createdApiKeySchema,
  successMessageSchema,
  teamSchema,
} from "./schemas";

/** Account-level tools act for a person; a team API key has none. */
const userAuthRequired = () =>
  toolError("forbidden", {
    reason: "user_auth_required",
    message: "This tool needs a signed-in user (OAuth), not a team API key.",
  });

const organizationAdminRequired = () =>
  toolError("forbidden", {
    reason: "organization_admin_required",
    message: "Organization administration is required.",
  });

export const teamTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_teams",
    operationId: "teams.list",
    title: "List Teams",
    risk: "read",
    description: "Returns all teams the authenticated user belongs to.",
    inputSchema: z.object({}),
    outputSchema: z.object({ items: z.array(teamSchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      if (!context.user) return userAuthRequired();
      const teams = await listTeamViewsForUser(context.user.id);
      return {
        items: teams.map((t) => ({
          teamId: t.teamId,
          name: t.name,
          organizationId: t.organizationPublicId,
          organizationName: t.organizationName,
        })),
      };
    },
  }),

  dedicatedTool({
    name: "get_plan_usage",
    operationId: "billing.organizationPlanUsage",
    title: "Get Plan Usage",
    risk: "read",
    description:
      "Returns plan usage and limits for the current team's organization. When cancelAtPeriodEnd is true the paid plan ends at paidThroughAt.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      plan: billingPlanSchema,
      paymentStatus: z.string(),
      cancelAtPeriodEnd: z.boolean(),
      paidThroughAt: z.string().nullable(),
      teams: z.number().int().nonnegative(),
      subscribedContacts: z.number().int().nonnegative(),
      monthlySends: z.number().int().nonnegative(),
      monthlySendsReserved: z.number().int().nonnegative(),
      bucketStartsAt: z.string(),
      bucketEndsAt: z.string(),
      teamsLimit: z.number().int().positive().nullable(),
      subscribedContactsLimit: z.number().int().positive().nullable(),
      monthlySendsLimit: z.number().int().positive().nullable(),
    }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      // `context.teamId` is the internal id.
      const team = await getTeam(context.teamId);
      if (!team) return notFound();
      const { usageForOrganization } = await import("../../billing/usage.js");
      const { getOrganizationEntitlements } = await import(
        "../../billing/entitlements.js"
      );
      const [usage, entitlements] = await Promise.all([
        usageForOrganization(team.organizationId),
        getOrganizationEntitlements(team.organizationId),
      ]);
      return {
        ...usage,
        plan: entitlements.plan,
        paymentStatus: entitlements.paymentStatus,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
        paidThroughAt: entitlements.paidThroughAt?.toISOString() ?? null,
        teamsLimit: entitlements.teamsLimit,
        subscribedContactsLimit: entitlements.subscribedContactsLimit,
        monthlySendsLimit: entitlements.monthlySendsLimit,
      };
    },
  }),

  dedicatedTool({
    name: "create_team",
    operationId: "teams.create",
    title: "Create Team",
    risk: "write",
    description:
      "Creates a new team in the authenticated user's default organization. Subject to the parent organization's plan team limit.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Team name"),
    }),
    outputSchema: teamSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const user = context.user;
      if (!user?.defaultOrganizationId) return userAuthRequired();
      try {
        const membership = await getOrganizationMembership(
          user.defaultOrganizationId,
          user.id,
        );
        if (!membership || !["owner", "admin"].includes(membership.role)) {
          return organizationAdminRequired();
        }
        const team = await createTeam({
          organizationId: user.defaultOrganizationId,
          creatorUserId: user.id,
          name: args.name,
        });
        return { teamId: team.teamId, name: team.name };
      } catch (error) {
        if (isPlanGateError(error)) return planGateError(error);
        throw error;
      }
    },
  }),

  dedicatedTool({
    name: "rename_team",
    operationId: "teams.rename",
    title: "Rename Team",
    risk: "write",
    description: "Renames the current team.",
    inputSchema: z.object({
      name: z.string().min(1).describe("New team name"),
    }),
    outputSchema: teamSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const updated = await renameTeam(context.teamId, args.name);
      if (!updated) return notFound();
      return { teamId: updated.teamId, name: updated.name };
    },
  }),

  dedicatedTool({
    name: "delete_team",
    operationId: "teams.remove",
    title: "Delete Team",
    risk: "destructive",
    description: "Archives a team. Organization administration is required.",
    inputSchema: z.object({
      teamId: z.string().describe("Team ID"),
    }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const user = context.user;
      if (!user) return userAuthRequired();
      const team = await getTeamByTeamId(args.teamId);
      if (!team) return notFound();
      const membership = await getTeamMembership(team.id, user.id);
      if (!membership) return notFound();
      const organizationMembership = await getOrganizationMembership(
        team.organizationId,
        user.id,
      );
      if (
        !organizationMembership ||
        !["owner", "admin"].includes(organizationMembership.role)
      ) {
        return organizationAdminRequired();
      }
      await archiveTeam(team.id);
      return { message: "Team archived." };
    },
  }),

  dedicatedTool({
    name: "list_api_keys",
    operationId: "teams.listKeys",
    title: "List API Keys",
    risk: "read",
    description:
      "Returns all API keys for the current team. Secrets are stored hashed, so only each key's display prefix is included.",
    inputSchema: z.object({}),
    outputSchema: z.object({ items: z.array(apiKeySchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      const keys = await getApiKeysByTeamId(context.teamId);
      return {
        items: keys.map((k) => ({
          id: k.teamApiKeyId,
          keyPrefix: k.keyPrefix,
          name: k.name,
          createdAt: k.createdAt,
        })),
      };
    },
  }),

  dedicatedTool({
    name: "create_api_key",
    operationId: "teams.createKey",
    title: "Create API Key",
    risk: "write",
    description:
      "Creates a new API key for the current team. The full key value is only returned once — store it securely.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Human-readable label for this key"),
    }),
    outputSchema: createdApiKeySchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const user = context.user;
      const { apiKey, secret } = await createApiKey(context.teamId, args.name, {
        createdByType: user ? "user" : "system",
        createdById: user?.id,
      });
      return {
        id: apiKey.teamApiKeyId,
        key: secret,
        keyPrefix: apiKey.keyPrefix,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
      };
    },
  }),

  dedicatedTool({
    name: "delete_api_key",
    operationId: "teams.removeKey",
    title: "Delete API Key",
    risk: "destructive",
    description:
      "Permanently deletes an API key. Any integrations using it will stop working immediately.",
    inputSchema: z.object({
      keyId: z.string().describe("Id of the API key to delete (from list_api_keys)"),
    }),
    outputSchema: successMessageSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      await deleteApiKey(context.teamId, args.keyId);
      return { message: "API key deleted." };
    },
  }),
];
