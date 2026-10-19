import {
  healthReport,
  type ReadinessReport,
  readOrCreateRequestId,
} from "@codelitdev/platform";
import { openApiDocument } from "@sendlit/api-contract/openapi";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { CLIENT_IP_HEADER } from "./abuse/signup";
import { auth } from "./auth/better-auth";
import oauthPagesRoutes from "./auth/oauth-pages";
import billingRoutes from "./billing/routes";
import billingWebhookRoutes from "./billing/webhooks/routes";
import contactsRoutes from "./contacts/routes";
import segmentsRoutes from "./contacts/segments-routes";
import deliveryRoutes from "./delivery/routes";
import deliveryEventsRoutes from "./delivery-feedback/delivery-events-routes";
import feedbackRoutes from "./delivery-feedback/feedback-routes";
import suppressionsRoutes from "./delivery-feedback/suppressions-routes";
import espWebhookRoutes from "./delivery-feedback/webhook-route";
import mcpRoutes from "./mcp/routes";
import mediaRoutes from "./media/routes";
import { captureError, getTeamId } from "./observability";
import organizationRoutes from "./organization/routes";
import overviewRoutes from "./overview/routes";
import provisioningRoutes from "./provisioning/routes";
import sequencesRoutes from "./sequences/routes";
import logger from "./services/log";
import espRoutes from "./settings/esp/routes";
import generalSettingsRoutes from "./settings/general/routes";
import teamRoutes from "./team/routes";
import templatesRoutes from "./templates/routes";
import trackingRoutes from "./tracking/routes";
import webViewRoutes from "./tracking/web-view";
import transactionalRoutes from "./transactional/routes";

export const SERVICE_NAME = "sendlit-api";

export type CreateAppOptions = {
  /** Current readiness, served at `/ready`. */
  readiness: () => Promise<ReadinessReport>;
};

/** The SendLit HTTP app. Starting workers, loops and the listener is the
 * entry point's job (src/index.ts), so tests can mount the same app. */
export function createApp(options: CreateAppOptions) {
  const app = express();

  app.set("trust proxy", process.env.ENABLE_TRUST_PROXY === "true" ? 1 : false);

  // Correlate logs and responses with the caller's X-Request-ID, or a new UUIDv7.
  app.use((req, res, next) => {
    const requestId = readOrCreateRequestId(req.get("x-request-id"));
    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  });
  app.use(cors());
  // MCP clients may use public dynamic client registration (DCR) during their
  // first OAuth connection. Keep that standards-based bootstrap available while
  // bounding anonymous client creation independently from authenticated API
  // traffic. Better Auth still validates the allowed scopes and PKCE below.
  app.use(
    "/api/auth/oauth2/register",
    rateLimit({
      windowMs: 60_000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: "too_many_requests",
        error_description: "Too many client registration requests.",
      },
    }),
  );
  // Hand Better Auth a client IP it can trust for the hosted signup guards:
  // Express's req.ip honours ENABLE_TRUST_PROXY, and any value the client
  // sent in this header is overwritten.
  app.use("/api/auth", (req, _res, next) => {
    req.headers[CLIENT_IP_HEADER] = req.ip ?? "";
    next();
  });
  app.all("/api/auth/*", toNodeHandler(auth));
  app.use(oauthPagesRoutes);
  // The MCP handler owns JSON parsing and protocol content-type errors, so it
  // must be mounted before the API's global Express body parser.
  app.use(mcpRoutes);
  // Mounted before global body parsing: this route needs the unmodified raw
  // request bytes for provider signature verification and has no
  // session/API-key concept at all — see delivery-feedback/webhook-route.ts.
  app.use(espWebhookRoutes);
  app.use(billingWebhookRoutes);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Liveness: the process is up. Readiness also checks Postgres and Redis and
  // turns false while starting or shutting down.
  app.get("/health", (_req, res) => {
    res.status(200).json(healthReport(SERVICE_NAME));
  });
  app.get("/ready", async (_req, res) => {
    const report = await options.readiness();
    res.status(report.status === "ready" ? 200 : 503).json(report);
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      explorer: true,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        defaultModelsExpandDepth: -1,
      },
    }),
  );

  // Public routes first: the MCP endpoint authenticates per-request via
  // OAuth bearer tokens or API keys; tracking/unsubscribe links are opened
  // directly by email clients/recipients. Since the routers below gate all of
  // their traffic with `router.use(requireAuth)`, anything mounted after them
  // would otherwise be incorrectly blocked by that blanket check.
  app.use(trackingRoutes);
  app.use(webViewRoutes);
  app.use(billingRoutes);
  app.use(provisioningRoutes);
  app.use(organizationRoutes);

  // Team management is user-scoped: `/teams` must be registered before the
  // routers below, whose blanket `requireTeam` middleware otherwise intercepts
  // it for multi-team accounts before `teamRoutes` can create/list teams.
  app.use(teamRoutes);
  app.use(deliveryRoutes);

  app.use(contactsRoutes);
  app.use(segmentsRoutes);
  app.use(mediaRoutes);
  app.use(templatesRoutes);
  app.use(sequencesRoutes);
  app.use(transactionalRoutes);
  app.use(espRoutes);
  app.use(generalSettingsRoutes);
  app.use(overviewRoutes);
  app.use(feedbackRoutes);
  app.use(deliveryEventsRoutes);
  app.use(suppressionsRoutes);

  app.use(
    (
      err: any,
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      captureError({
        error: err,
        source: "express.uncaught",
        teamId: getTeamId((req as any)?.user?.teamId),
        context: {
          path: req?.path,
          method: req?.method,
        },
      });
      next(err);
    },
  );

  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error(
        { error: err.message, requestId: res.locals.requestId },
        "Unhandled express error",
      );
      res.status(500).json({ error: "server_error" });
    },
  );

  return app;
}
