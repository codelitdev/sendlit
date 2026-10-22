import { z } from "zod";
import {
  getTrackingDomain,
  setTrackingDomain,
  toPublicTrackingDomain,
  verifyTrackingDomain,
} from "../../settings/tracking-domain/queries";
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import { AUTH_ERROR, errorResult, jsonResult } from "./responses";
import { trackingDomainSchema } from "./schemas";

export function registerTrackingDomainTools(server: McpToolRegistrar): void {
  server.registerTool(
    "get_tracking_domain",
    {
      description:
        "Returns the team's custom tracking domain: the domain, its status (`pending`, `verified` or `failed`), the CNAME target, and why the last check failed. Open, click, unsubscribe and \"view in browser\" links use the domain once it is verified; otherwise SendLit's own host.",
      outputSchema: trackingDomainSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult(toPublicTrackingDomain(await getTrackingDomain(teamId)));
    },
  );

  server.registerTool(
    "set_tracking_domain",
    {
      description:
        "Sets or removes the team's custom tracking domain. Use a subdomain such as `track.example.com` and add a CNAME record pointing to the returned `cnameTarget`; the domain is `pending` until verified (SendLit rechecks hourly, or call verify_tracking_domain). `null` removes it. Links already sent on a previous domain keep working. Errors: `tracking_domain_invalid`, `tracking_domain_taken`.",
      inputSchema: {
        domain: z
          .string()
          .max(253)
          .nullable()
          .describe("e.g. track.example.com; null removes it"),
      },
      outputSchema: trackingDomainSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        return jsonResult(
          toPublicTrackingDomain(await setTrackingDomain(teamId, args.domain)),
        );
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  server.registerTool(
    "verify_tracking_domain",
    {
      description:
        "Checks the team's custom tracking domain now: its CNAME record and that SendLit answers over HTTPS on it. Returns the updated status. Error: `tracking_domain_not_set`.",
      outputSchema: trackingDomainSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      try {
        return jsonResult(toPublicTrackingDomain(await verifyTrackingDomain(teamId)));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );
}
