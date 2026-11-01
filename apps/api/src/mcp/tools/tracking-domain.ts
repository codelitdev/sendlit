import { z } from "zod";
import {
  getTrackingDomain,
  setTrackingDomain,
  toPublicTrackingDomain,
  verifyTrackingDomain,
} from "../../settings/tracking-domain/queries";
import type { SendLitMcpContext, SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { type ToolError, toolError } from "./responses";
import { trackingDomainSchema } from "./schemas";

/** The tracking-domain codes REST answers with; anything else is thrown. */
const TRACKING_DOMAIN_ERRORS: Record<
  string,
  [Parameters<typeof toolError>[0], string]
> = {
  tracking_domain_invalid: [
    "validation_failed",
    "Use a subdomain you control, such as track.example.com.",
  ],
  tracking_domain_taken: ["conflict", "Another team already uses this domain."],
  tracking_domain_not_set: ["validation_failed", "Set a tracking domain first."],
};

function trackingDomainError(err: unknown): ToolError {
  const code = err instanceof Error ? err.message : "";
  const known = TRACKING_DOMAIN_ERRORS[code];
  if (!known) throw err;
  return toolError(known[0], { reason: code, message: known[1] });
}

async function current(context: SendLitMcpContext) {
  return toPublicTrackingDomain(await getTrackingDomain(context.teamId));
}

export const trackingDomainTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "get_tracking_domain",
    title: "Get Tracking Domain",
    operationId: "settings.trackingDomain.get",
    risk: "read",
    description:
      "Returns the team's custom tracking domain: the domain, its status (`pending`, `verified` or `failed`), the CNAME target, and why the last check failed. Open, click, unsubscribe and \"view in browser\" links use the domain once it is verified; otherwise SendLit's own host.",
    inputSchema: z.object({}),
    outputSchema: trackingDomainSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    handler: ({ context }) => current(context),
  }),

  dedicatedTool({
    name: "set_tracking_domain",
    title: "Set Tracking Domain",
    operationId: "settings.trackingDomain.update",
    risk: "write",
    description:
      "Sets or removes the team's custom tracking domain. Use a subdomain such as `track.example.com` and add a CNAME record pointing to the returned `cnameTarget`; the domain is `pending` until verified (SendLit rechecks hourly, or call verify_tracking_domain). `null` removes it. Links already sent on a previous domain keep working. Errors: `tracking_domain_invalid`, `tracking_domain_taken`.",
    inputSchema: z.object({
      domain: z
        .string()
        .max(253)
        .nullable()
        .describe("e.g. track.example.com; null removes it"),
    }),
    outputSchema: trackingDomainSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      try {
        return toPublicTrackingDomain(
          await setTrackingDomain(context.teamId, args.domain),
        );
      } catch (err) {
        return trackingDomainError(err);
      }
    },
  }),

  dedicatedTool({
    name: "verify_tracking_domain",
    title: "Verify Tracking Domain",
    operationId: "settings.trackingDomain.verify",
    risk: "write",
    description:
      "Checks the team's custom tracking domain now: its CNAME record and that SendLit answers over HTTPS on it. Returns the updated status. Error: `tracking_domain_not_set`.",
    inputSchema: z.object({}),
    outputSchema: trackingDomainSchema,
    annotations: { idempotentHint: true, openWorldHint: true },
    async handler({ context }) {
      try {
        return toPublicTrackingDomain(await verifyTrackingDomain(context.teamId));
      } catch (err) {
        return trackingDomainError(err);
      }
    },
  }),
];
