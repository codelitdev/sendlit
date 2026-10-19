import { connectSndsBodySchema, reputationSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { startGoogleConnect } from "../../reputation/google";
import { deleteConnection, getReputation } from "../../reputation/queries";
import { SndsLinkError } from "../../reputation/snds";
import { connectSnds, syncTeamNow } from "../../reputation/sync";
import { consumeRateLimit } from "../../services/rate-counter";
import type { McpToolRegistrar } from "../tool-registry";
import { getAuthUser, getTeamId } from "./auth";
import { AUTH_ERROR, errorResult, jsonResult, NOT_FOUND } from "./responses";

const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export function registerReputationTools(server: McpToolRegistrar): void {
  server.registerTool(
    "get_reputation",
    {
      description:
        "Returns the last 30 days of mailbox provider reputation data and current alerts: Google Postmaster Tools per sending domain (user-reported spam rate, SPF/DKIM/DMARC pass rates, delivery error rate, compliance with Google's sender requirements) and Microsoft SNDS per IP (filter result, complaint rate, spam trap hits). Rates are fractions (0.003 = 0.3%).",
      outputSchema: reputationSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult(await getReputation(teamId));
    },
  );

  server.registerTool(
    "connect_google_postmaster",
    {
      description:
        "Returns a Google sign-in URL that a person must open in a browser to connect Google Postmaster Tools. Each sending domain must be verified in Postmaster Tools with that Google account.",
      outputSchema: z.object({ authorizationUrl: z.string() }),
      annotations: write,
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const url = startGoogleConnect(teamId, getAuthUser(extra)?.id ?? null);
      if (!url) return errorResult("google_postmaster_not_configured");
      return jsonResult({ authorizationUrl: url });
    },
  );

  server.registerTool(
    "disconnect_google_postmaster",
    {
      description: "Disconnects Google Postmaster Tools and deletes its stored data.",
      outputSchema: z.object({ disconnected: z.boolean() }),
      annotations: { ...write, destructiveHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return (await deleteConnection(teamId, "google_postmaster"))
        ? jsonResult({ disconnected: true })
        : NOT_FOUND;
    },
  );

  server.registerTool(
    "connect_snds",
    {
      description:
        "Connects Microsoft SNDS with its automated data access link (from SNDS's Automated Data Access page). The link is checked by downloading the data once; it expires after 30 days.",
      inputSchema: connectSndsBodySchema.shape,
      outputSchema: reputationSchema,
      annotations: write,
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        await connectSnds(teamId, args.dataUrl);
      } catch (error) {
        if (error instanceof SndsLinkError) return errorResult("snds_link_invalid");
        throw error;
      }
      return jsonResult(await getReputation(teamId));
    },
  );

  server.registerTool(
    "disconnect_snds",
    {
      description: "Disconnects Microsoft SNDS and deletes its stored data.",
      outputSchema: z.object({ disconnected: z.boolean() }),
      annotations: { ...write, destructiveHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return (await deleteConnection(teamId, "microsoft_snds"))
        ? jsonResult({ disconnected: true })
        : NOT_FOUND;
    },
  );

  server.registerTool(
    "sync_reputation",
    {
      description:
        "Refreshes reputation data now instead of waiting for the daily sync. Limited to once every 5 minutes.",
      outputSchema: reputationSchema,
      annotations: write,
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      if (!(await consumeRateLimit(`reputation-sync:${teamId}`, 1, 300))) {
        return errorResult("too_many_requests");
      }
      await syncTeamNow(teamId);
      return jsonResult(await getReputation(teamId));
    },
  );
}
