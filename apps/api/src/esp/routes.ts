import { Router } from "express";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
  deleteEspConfig,
  getEspConfig,
  recordEspTestResult,
  upsertEspConfig,
  type EspConfig,
} from "./queries";
import { invalidateTeamTransport } from "../mail/transport";
import { sendTestMail } from "../mail/send";
import { getEmailFrom } from "../utils/mail";
import { getTeam } from "../team/queries";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

const s = initServer();

function toPublicShape(config: EspConfig | null) {
  if (!config) return null;
  return {
    provider: config.provider,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    hasPassword: Boolean(config.encryptedSecret),
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: config.lastTestStatus as "success" | "failed" | null,
    lastTestError: config.lastTestError,
    updatedAt: config.updatedAt?.toISOString(),
  };
}

const impl = s.router(contract.esp, {
  get: async ({ req }) => {
    const config = await getEspConfig((req as any).teamId);
    return { status: 200, body: toPublicShape(config) };
  },
  upsert: async ({ body, req }) => {
    const teamId = (req as any).teamId;
    const config = await upsertEspConfig(teamId, body);
    invalidateTeamTransport(teamId);
    return { status: 200, body: toPublicShape(config)! };
  },
  remove: async ({ req }) => {
    const teamId = (req as any).teamId;
    await deleteEspConfig(teamId);
    invalidateTeamTransport(teamId);
    return { status: 204, body: undefined };
  },
  test: async ({ body, req }) => {
    const teamId = (req as any).teamId;
    const config = await getEspConfig(teamId);
    if (!config) {
      return {
        status: 400,
        body: { error: "No ESP configured for this team yet." },
      };
    }

    const account = (req as any).account as {
      name?: string;
      email?: string;
    } | null;
    const team = await getTeam(teamId);
    const to = body.to || account?.email;
    if (!to) {
      return {
        status: 400,
        body: { error: "No destination email address available." },
      };
    }

    const from = getEmailFrom({
      name: config.fromName || team?.fromName || account?.name || "SendLit",
      email: config.fromEmail || team?.fromEmail || account?.email || "",
    });

    try {
      await sendTestMail({
        from,
        to,
        subject: "SendLit test email",
        html: "<p>This is a test email from your SendLit ESP configuration. If you're reading this, it works!</p>",
        teamId,
      });
      await recordEspTestResult(teamId, "success");
      return { status: 200, body: { success: true } };
    } catch (err: any) {
      await recordEspTestResult(teamId, "failed", err.message);
      return { status: 502, body: { success: false, error: err.message } };
    }
  },
});

createExpressEndpoints(contract.esp, impl, router);

export default router;
