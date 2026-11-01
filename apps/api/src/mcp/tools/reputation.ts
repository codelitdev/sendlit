import { connectSndsBodySchema, reputationSchema } from "@sendlit/api-contract";
import { z } from "zod";
import { startGoogleConnect } from "../../reputation/google";
import { deleteConnection, getReputation } from "../../reputation/queries";
import { SndsLinkError } from "../../reputation/snds";
import { connectSnds, syncTeamNow } from "../../reputation/sync";
import { consumeRateLimit } from "../../services/rate-counter";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";

const disconnected = z.object({ disconnected: z.boolean() });

export const reputationTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_reputation",
    title: "Get Sender Reputation",
    operationId: "reputation.get",
    risk: "read",
    description:
      "Returns the last 30 days of mailbox provider reputation data and current alerts: Google Postmaster Tools per sending domain (user-reported spam rate, SPF/DKIM/DMARC pass rates, delivery error rate, compliance with Google's sender requirements) and Microsoft SNDS per IP (filter result, complaint rate, spam trap hits). Rates are fractions (0.003 = 0.3%).",
    inputSchema: z.object({}),
    outputSchema: reputationSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    handler: ({ context }) => getReputation(context.teamId),
  }),

  dedicatedTool({
    name: "connect_google_postmaster",
    title: "Connect Google Postmaster Tools",
    operationId: "reputation.connectGoogle",
    risk: "write",
    description:
      "Returns a Google sign-in URL that a person must open in a browser to connect Google Postmaster Tools. Each sending domain must be verified in Postmaster Tools with that Google account.",
    inputSchema: z.object({}),
    outputSchema: z.object({ authorizationUrl: z.string() }),
    annotations: { openWorldHint: true },
    async handler({ context }) {
      const url = startGoogleConnect(context.teamId, context.user?.id ?? null);
      if (!url) {
        return toolError("conflict", {
          reason: "google_postmaster_not_configured",
          message: "Google Postmaster Tools isn't configured on this SendLit server.",
        });
      }
      return { authorizationUrl: url };
    },
  }),

  dedicatedTool({
    name: "disconnect_google_postmaster",
    title: "Disconnect Google Postmaster Tools",
    operationId: "reputation.disconnectGoogle",
    risk: "destructive",
    description: "Disconnects Google Postmaster Tools and deletes its stored data.",
    inputSchema: z.object({}),
    outputSchema: disconnected,
    annotations: { openWorldHint: false },
    async handler({ context }) {
      return (await deleteConnection(context.teamId, "google_postmaster"))
        ? { disconnected: true }
        : notFound();
    },
  }),

  dedicatedTool({
    name: "connect_snds",
    title: "Connect Microsoft SNDS",
    operationId: "reputation.connectSnds",
    risk: "write",
    description:
      "Connects Microsoft SNDS with its automated data access link (from SNDS's Automated Data Access page). The link is checked by downloading the data once; it expires after 30 days.",
    inputSchema: connectSndsBodySchema,
    outputSchema: reputationSchema,
    annotations: { openWorldHint: true },
    async handler({ context, args }) {
      try {
        await connectSnds(context.teamId, args.dataUrl);
      } catch (error) {
        if (error instanceof SndsLinkError) {
          return toolError("validation_failed", {
            reason: "snds_link_invalid",
            message:
              "SNDS didn't return data for this link. Copy the automated data access link again; it expires after 30 days.",
          });
        }
        throw error;
      }
      return getReputation(context.teamId);
    },
  }),

  dedicatedTool({
    name: "disconnect_snds",
    title: "Disconnect Microsoft SNDS",
    operationId: "reputation.disconnectSnds",
    risk: "destructive",
    description: "Disconnects Microsoft SNDS and deletes its stored data.",
    inputSchema: z.object({}),
    outputSchema: disconnected,
    annotations: { openWorldHint: false },
    async handler({ context }) {
      return (await deleteConnection(context.teamId, "microsoft_snds"))
        ? { disconnected: true }
        : notFound();
    },
  }),

  dedicatedTool({
    name: "sync_reputation",
    title: "Sync Sender Reputation",
    operationId: "reputation.sync",
    risk: "write",
    description:
      "Refreshes reputation data now instead of waiting for the daily sync. Limited to once every 5 minutes.",
    inputSchema: z.object({}),
    outputSchema: reputationSchema,
    annotations: { openWorldHint: true },
    async handler({ context }) {
      if (!(await consumeRateLimit(`reputation-sync:${context.teamId}`, 1, 300))) {
        return toolError("rate_limited", {
          reason: "too_many_requests",
          message: "Reputation can be synced once every 5 minutes.",
        });
      }
      await syncTeamNow(context.teamId);
      return getReputation(context.teamId);
    },
  }),
];
