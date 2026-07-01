import { config as loadDotFile } from "dotenv";
loadDotFile();

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@sendlit/api-contract";
import logger from "./services/log";
import { checkDatabaseConnection } from "./db/client";
import mcpRoutes from "./mcp/routes";
import contactsRoutes from "./contacts/routes";
import templatesRoutes from "./templates/routes";
import sequencesRoutes from "./sequences/routes";
import espRoutes from "./esp/routes";
import teamRoutes from "./team/routes";
import provisioningRoutes from "./provisioning/routes";
import trackingRoutes from "./tracking/routes";
import { assertEspEncryptionKeyConfigured } from "./utils/secret-crypto";
import { createSuperAdminIfMissing } from "./bootstrap";

// Start BullMQ workers
import "./mail/worker";
import "./mail/sequence-worker";

import { startAutomation } from "./automation/start";

const openApiDocument = generateOpenApi(
  contract,
  {
    info: {
      title: "SendLit API",
      description:
        "OAuth2 protected REST API for composing, sending and automating email.",
      version: "0.1.0",
    },
    servers: [
      {
        url: "{protocol}://{host}",
        description: "API Server",
        variables: {
          protocol: { default: "https", enum: ["https", "http"] },
          host: { default: "api.sendlit.dev" },
        },
      },
    ],
    tags: [
      { name: "Contacts", description: "Manage contacts (subscribers) and segmentation." },
      { name: "Templates", description: "Reusable email templates." },
      { name: "Sequences", description: "Broadcasts (one-off) and sequences (multi-step, event-triggered)." },
      { name: "ESP", description: "Per-team email sending provider (SMTP) configuration and test sends." },
      { name: "Teams", description: "Team management (list/create/rename/delete), per-team API keys, and server-to-server provisioning." },
    ],
    components: {
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-sendlit-apikey" },
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
  {
    operationMapper: (operation, route) => ({
      ...operation,
      tags: (route.metadata as { tag?: string } | undefined)?.tag
        ? [(route.metadata as { tag: string }).tag]
        : operation.tags,
    }),
  },
);

const app = express();

app.set("trust proxy", process.env.ENABLE_TRUST_PROXY === "true" ? 1 : false);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Status of the server and uptime.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
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

// Public routes first: none of these require an OAuth bearer token (the
// OAuth endpoints authenticate themselves; the MCP endpoint authenticates
// per-request via its own OAuth-or-API-key check; tracking/unsubscribe links
// are opened directly by email clients/recipients). Since the routers below
// gate all of their traffic with `router.use(requireAuth)`, anything mounted
// after them would otherwise be incorrectly blocked by that blanket check.
// `mcpRoutes` also mounts the OAuth routes itself (with CORS enabled for
// `/oauth` and `/.well-known`, needed by cross-origin MCP clients).
app.use(mcpRoutes);
app.use(trackingRoutes);
app.use(provisioningRoutes);

app.use(contactsRoutes);
app.use(templatesRoutes);
app.use(sequencesRoutes);
app.use(espRoutes);
app.use(teamRoutes);

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ error: err.message }, "Unhandled express error");
    res.status(500).json({ error: "server_error" });
  },
);

const port = process.env.PORT || 80;

checkConfig()
  .then(checkDatabaseConnection)
  .then(createSuperAdminIfMissing)
  .then(() => {
    app.listen(port, () => {
      logger.info(`SendLit API running at ${port}`);
    });
    startAutomation();
  })
  .catch((err) => {
    logger.error({ error: err.message }, "Failed to start SendLit API");
    process.exit(1);
  });

async function checkConfig() {
  if (!process.env.DB_CONNECTION_STRING) {
    throw new Error("DB_CONNECTION_STRING is not set");
  }
  if (
    !process.env.OAUTH_SIGNING_KEY ||
    Buffer.byteLength(process.env.OAUTH_SIGNING_KEY, "utf8") < 32
  ) {
    throw new Error(
      "OAUTH_SIGNING_KEY is required and must be at least 32 bytes (256 bits). " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  if (!process.env.PIXEL_SIGNING_SECRET) {
    throw new Error("PIXEL_SIGNING_SECRET is not set");
  }
  assertEspEncryptionKeyConfigured();
}
