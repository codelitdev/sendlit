import { contract } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { type Request, type Response, Router } from "express";
import { webClientUrl } from "../auth/better-auth";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { captureError } from "../observability";
import { consumeRateLimit } from "../services/rate-counter";
import { getTeamMembership } from "../team/queries";
import { verifyPixelToken } from "../utils/pixel-jwt";
import {
  exchangeGoogleCode,
  GOOGLE_CALLBACK_PATH,
  googlePostmasterConfig,
  startGoogleConnect,
} from "./google";
import { deleteConnection, getReputation, saveConnection } from "./queries";
import { SndsLinkError } from "./snds";
import { connectSnds, syncConnection, syncTeamNow } from "./sync";

const router = Router();
router.use("/reputation", requireAuth, requireTeam);

const s = initServer();

/** Connecting accounts changes what the team shares with SendLit: team
 * admins and team API keys only. */
async function canManage(req: any): Promise<boolean> {
  if (req.authKind === "team_key") return true;
  const membership = await getTeamMembership(req.teamId, req.userId);
  return membership?.role === "admin";
}

const FORBIDDEN = { status: 403 as const, body: { error: "team_admin_required" } };

const impl = s.router(contract.reputation, {
  get: async ({ req }) => ({
    status: 200,
    body: await getReputation((req as any).teamId),
  }),
  connectGoogle: async ({ req }) => {
    if (!(await canManage(req))) return FORBIDDEN;
    const url = startGoogleConnect((req as any).teamId, (req as any).userId ?? null);
    if (!url)
      return { status: 409, body: { error: "google_postmaster_not_configured" } };
    return { status: 200, body: { authorizationUrl: url } };
  },
  disconnectGoogle: async ({ req }) => {
    if (!(await canManage(req))) return FORBIDDEN;
    return (await deleteConnection((req as any).teamId, "google_postmaster"))
      ? { status: 204, body: undefined }
      : { status: 404, body: { error: "Not connected" } };
  },
  connectSnds: async ({ body, req }) => {
    if (!(await canManage(req))) return FORBIDDEN;
    try {
      await connectSnds((req as any).teamId, body.dataUrl);
    } catch (error) {
      if (error instanceof SndsLinkError) {
        return { status: 422, body: { error: "snds_link_invalid" } };
      }
      throw error;
    }
    return { status: 200, body: await getReputation((req as any).teamId) };
  },
  disconnectSnds: async ({ req }) => {
    if (!(await canManage(req))) return FORBIDDEN;
    return (await deleteConnection((req as any).teamId, "microsoft_snds"))
      ? { status: 204, body: undefined }
      : { status: 404, body: { error: "Not connected" } };
  },
  sync: async ({ req }) => {
    const teamId = (req as any).teamId;
    if (!(await consumeRateLimit(`reputation-sync:${teamId}`, 1, 300))) {
      return { status: 429, body: { error: "too_many_requests" } };
    }
    await syncTeamNow(teamId);
    return { status: 200, body: await getReputation(teamId) };
  },
});

createExpressEndpoints(contract.reputation, impl, router);

/** Where Google sends the browser back after consent. */
router.get(GOOGLE_CALLBACK_PATH, async (req: Request, res: Response) => {
  const back = (result: string) =>
    res.redirect(303, `${webClientUrl}/?reputation=${result}`);
  const state = verifyPixelToken<{
    kind?: string;
    teamId?: string;
    userId?: string | null;
  }>(String(req.query.state ?? ""));
  const config = googlePostmasterConfig();
  if (state?.kind !== "google_postmaster" || !state.teamId || !config) {
    return back("google_failed");
  }
  if (req.query.error || typeof req.query.code !== "string")
    return back("google_cancelled");
  try {
    const { refreshToken, email } = await exchangeGoogleCode(config, req.query.code);
    const connection = await saveConnection(
      state.teamId,
      "google_postmaster",
      refreshToken,
      email,
    );
    // The first data shouldn't wait for the daily job.
    void syncConnection(connection).catch((error) =>
      captureError({ error, source: "reputation.first_sync" }),
    );
    return back("google_connected");
  } catch (error) {
    captureError({ error, source: "reputation.google_callback" });
    return back("google_failed");
  }
});

export default router;
