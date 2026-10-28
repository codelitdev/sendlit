import { contract, eventNameSchema } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { isPlanGateError } from "../billing/errors";
import {
  createEventDefinition,
  deleteEventDefinition,
  type EventSource,
  EventsError,
  getEventDefinition,
  listEventDefinitions,
  trackEvent,
  updateEventDefinition,
} from "./queries";

const router = Router();
router.use("/events", requireAuth, requireTeam);

// Team-keyed, like transactional (`docs/transactional-emails.md#rate-limiting`):
// one server often sends for many teams from a single IP. Events are higher
// volume than sends but far cheaper. See docs/custom_events.md.
function teamKey(req: any): string {
  return req.teamId;
}

const limiter = (max: number) =>
  rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: teamKey,
    message: { error: "too_many_requests", error_description: "Too many requests." },
  });
const trackLimiter = limiter(600);
const readLimiter = limiter(300);

// Mounted at the API root: scope the limiters to `/events` only.
router.use("/events", (req, res, next) => {
  if (req.method === "POST" && req.path === "/") return trackLimiter(req, res, next);
  return readLimiter(req, res, next);
});

function sourceOf(req: any): EventSource {
  return req.authKind === "session" ? "session" : "api";
}

/** `:name` arrives URL-decoded; normalize it the same way names are stored. */
function definitionName(raw: string): string | null {
  const parsed = eventNameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const NOT_FOUND = {
  status: 404 as const,
  body: { error: "event_definition_not_found" },
};

const s = initServer();

const impl = s.router(contract.events, {
  track: async ({ body, req }) => {
    try {
      const result = await trackEvent({
        teamId: (req as any).teamId,
        source: sourceOf(req),
        body,
      });
      return { status: 202, body: result };
    } catch (err) {
      if (isPlanGateError(err)) {
        return { status: err.status, body: { error: err.code, ...err.details } } as any;
      }
      if (err instanceof EventsError) {
        const status = err.code === "contact_not_found" ? 404 : 422;
        return { status, body: { error: err.code } };
      }
      throw err;
    }
  },
  definitions: async ({ req }) => {
    return {
      status: 200,
      body: { items: await listEventDefinitions((req as any).teamId) },
    };
  },
  definition: async ({ params, req }) => {
    const name = definitionName(params.name);
    const row = name ? await getEventDefinition((req as any).teamId, name) : null;
    if (!row) return NOT_FOUND;
    return { status: 200, body: row };
  },
  createDefinition: async ({ body, req }) => {
    try {
      const row = await createEventDefinition((req as any).teamId, body);
      return { status: 201, body: row };
    } catch (err) {
      if (err instanceof EventsError) {
        const status = err.code === "event_definition_exists" ? 409 : 422;
        return { status, body: { error: err.code } };
      }
      throw err;
    }
  },
  updateDefinition: async ({ params, body, req }) => {
    const name = definitionName(params.name);
    const row = name
      ? await updateEventDefinition((req as any).teamId, name, body)
      : null;
    if (!row) return NOT_FOUND;
    return { status: 200, body: row };
  },
  deleteDefinition: async ({ params, req }) => {
    try {
      const name = definitionName(params.name);
      const deleted = name
        ? await deleteEventDefinition((req as any).teamId, name)
        : null;
      if (!deleted) return NOT_FOUND;
      return { status: 204, body: undefined };
    } catch (err) {
      if (err instanceof EventsError) return { status: 409, body: { error: err.code } };
      throw err;
    }
  },
});

createExpressEndpoints(contract.events, impl, router);

export default router;
