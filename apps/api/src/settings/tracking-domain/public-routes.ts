import { isIP } from "node:net";
import { type NextFunction, type Request, type Response, Router } from "express";
import logger from "../../services/log";
import {
  isTrackingHost,
  isTrackingPath,
  TRACKING_PROBE_BODY,
  TRACKING_PROBE_PATH,
} from "./queries";

/** Tracking domains have at least three labels; skip the lookup for IPs and
 * single-label hosts (localhost, container names, health checks). */
function couldBeTrackingHost(host: string): boolean {
  return host.split(".").length >= 3 && !isIP(host);
}

/**
 * On a team's tracking domain, only the tracking routes answer: the rest of
 * the API (auth, dashboard routes, OAuth) stays on SendLit's own host.
 */
export async function trackingHostGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const host = req.hostname;
  if (!host || !couldBeTrackingHost(host) || isTrackingPath(req.path)) return next();
  try {
    if (await isTrackingHost(host)) {
      res.status(404).type("text").send("Not found");
      return;
    }
  } catch (error: any) {
    logger.error({ error: error?.message }, "tracking host lookup failed");
  }
  next();
}

const router = Router();

// Answered on any host, so verification can tell the domain reaches this API.
router.get(TRACKING_PROBE_PATH, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(TRACKING_PROBE_BODY);
});

// For a TLS terminator that issues certificates on demand (Caddy's
// `on_demand_tls { ask ... }`): 200 for a team's current or retired tracking
// domain, 404 otherwise.
router.get("/tls/ask", async (req, res) => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : "";
  const allowed = couldBeTrackingHost(domain) && (await isTrackingHost(domain));
  res.status(allowed ? 200 : 404).end();
});

export default router;
