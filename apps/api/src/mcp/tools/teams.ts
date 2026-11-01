import { billingPlanSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { getTeam } from "../../team/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound } from "./responses";

/** Teams and API keys are reachable through the generic `api.*` tools. */
export const teamTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_plan_usage",
    operationId: "billing.organizationPlanUsage",
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
];
