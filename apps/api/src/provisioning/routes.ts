import crypto from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import {
  findOrCreateBareAccount,
  findOrCreateTeamByExternalId,
} from "../team/queries";
import { getApiKeysByTeamId } from "../apikey/queries";
import logger from "../services/log";

const router = Router();

const provisioningLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    error_description: "Too many requests.",
  },
});
router.use(provisioningLimiter);

/** Constant-time comparison so an invalid secret can't be brute-forced via
 * response-time differences. */
function isValidSecret(provided: string | undefined): boolean {
  const expected = process.env.PROVISIONING_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const s = initServer();

/**
 * Server-to-server provisioning for multi-tenant consumers (e.g. CourseLit:
 * one team per CourseLit "domain"). Guarded by a static shared secret rather
 * than OAuth/API-key auth, since at provisioning time no team exists yet for
 * the caller to authenticate as. Idempotent: calling this again for the same
 * `externalId` returns the same team's (existing) API key rather than
 * creating a duplicate team.
 */
const impl = s.router(contract.provisioning, {
  provisionTeam: async ({ body, req }) => {
    if (
      !isValidSecret(
        req.headers["x-sendlit-provisioning-secret"] as string | undefined,
      )
    ) {
      return { status: 401, body: { error: "unauthorized" } };
    }

    try {
      const account = await findOrCreateBareAccount(body.ownerEmail);
      const team = await findOrCreateTeamByExternalId({
        externalId: body.externalId,
        ownerAccountId: account.id,
        name: body.name,
      });
      const keys = await getApiKeysByTeamId(team.id);

      return {
        status: 200,
        body: { teamId: team.id, name: team.name, apiKey: keys[0]?.key },
      };
    } catch (err: any) {
      logger.error({ error: err.message }, "Team provisioning failed");
      return { status: 500, body: { error: "server_error" } };
    }
  },
});

createExpressEndpoints(contract.provisioning, impl, router);

export default router;
