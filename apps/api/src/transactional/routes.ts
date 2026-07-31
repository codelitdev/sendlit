import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import {
    countTransactionalEmails,
    createTransactionalEmail,
    getTransactionalEmailByTxeId,
    listTransactionalEmails,
    toPublicTransactionalEmail,
} from "./queries";
import { MAILING_ADDRESS_REQUIRED } from "../settings/general/constants";
import {
    MISSING_TEMPLATE_VARIABLES,
    MissingTemplateVariablesError,
} from "../mail/render";

const router = Router();
router.use("/emails", requireAuth, requireTeam);

// Team-keyed (not IP-keyed): the typical caller is one server (e.g.
// CourseLit) sending on behalf of many teams from a single IP, so IP keying
// would let one tenant's volume exhaust another tenant's allowance. `send`
// gets the tighter limit (Resend-comparable, ~2 rps); reads are looser since
// they back the dashboard log page's polling. See
// `docs/transactional-emails.md#rate-limiting`.
function teamKey(req: any): string {
    return req.teamId;
}

const sendLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: teamKey,
    message: {
        error: "too_many_requests",
        error_description: "Too many requests.",
    },
});

const readLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: teamKey,
    message: {
        error: "too_many_requests",
        error_description: "Too many requests.",
    },
});

// Like the provisioning router, this router is mounted at the API root.
// Apply delivery limits only to transactional endpoints, not every request
// that passes through this router while Express searches for a route match.
router.use("/emails", (req, res, next) => {
    if (req.method === "POST") return sendLimiter(req, res, next);
    return readLimiter(req, res, next);
});

const s = initServer();

const impl = s.router(contract.transactional, {
    send: async ({ body, req }) => {
        try {
            const row = await createTransactionalEmail({
                teamId: (req as any).teamId,
                to: body.to,
                subject: body.subject,
                templateId: body.templateId,
                html: body.html,
                variables: body.variables,
                replyTo: body.replyTo,
                headers: body.headers,
                idempotencyKey: body.idempotencyKey,
                trackOpens: body.trackOpens,
                trackClicks: body.trackClicks,
                deliverySource: body.deliverySource,
            });
            return {
                status: 202,
                body: { txeId: row.txeId, status: row.status as any },
            };
        } catch (err: any) {
            if (err instanceof MissingTemplateVariablesError) {
                return {
                    status: 422,
                    body: {
                        error: MISSING_TEMPLATE_VARIABLES,
                        missingVariables: err.missingVariables,
                    },
                };
            }
            switch (err.message) {
                case "invalid_content":
                    return {
                        status: 400,
                        body: {
                            error:
                                "Provide exactly one of templateId or html; " +
                                "variables requires templateId",
                        },
                    };
                case "invalid_headers":
                    return {
                        status: 400,
                        body: {
                            error:
                                "Header names/values must not contain CR/LF; " +
                                "From, To, Subject and Content-Type are set " +
                                "by the send pipeline",
                        },
                    };
                case "template_not_found":
                    return {
                        status: 400,
                        body: { error: "Template not found" },
                    };
                case "template_not_transactional":
                    return {
                        status: 422,
                        body: { error: "template_not_transactional" },
                    };
                case "marketing_variables_not_allowed":
                    return {
                        status: 422,
                        body: { error: "marketing_variables_not_allowed" },
                    };
                case "render_failed":
                    return {
                        status: 400,
                        body: { error: "Template rendering failed" },
                    };
                case "esp_not_configured":
                    return {
                        status: 422,
                        body: { error: "Team ESP is not configured." },
                    };
                case MAILING_ADDRESS_REQUIRED:
                    return {
                        status: 422,
                        body: {
                            error: "A mailing address is required before sending email.",
                        },
                    };
                case "esp_not_found":
                    return { status: 422, body: { error: "ESP not found" } };
                case "recipient_suppressed":
                    // Stable error code per docs/bounces-and-complaints.md's
                    // "Error codes are stable strings" — unlike the
                    // human-readable messages above, API clients are
                    // expected to branch on this value programmatically.
                    return {
                        status: 422,
                        body: { error: "recipient_suppressed" },
                    };
                case "organization_team_quota_exhausted":
                case "organization_quota_exhausted":
                    return {
                        status: 429,
                        body: { error: err.message },
                    };
                case "delivery_source_required":
                case "delivery_source_unavailable":
                case "organization_delivery_disabled":
                case "organization_sending_suspended":
                case "team_sending_suspended":
                case "team_esp_disabled":
                    return {
                        status: 422,
                        body: { error: err.message },
                    };
                default:
                    throw err;
            }
        }
    },
    get: async ({ params, req }) => {
        const row = await getTransactionalEmailByTxeId(params.txeId);
        if (!row || row.teamId !== (req as any).teamId) {
            return {
                status: 404,
                body: { error: "Transactional email not found" },
            };
        }
        return {
            status: 200,
            body: toPublicTransactionalEmail(row, { includeHtml: true }) as any,
        };
    },
    list: async ({ query, req }) => {
        const teamId = (req as any).teamId;
        const filters = {
            status: query.status,
            createdAfter: query.createdAfter,
            createdBefore: query.createdBefore,
        };
        const [items, total] = await Promise.all([
            listTransactionalEmails({
                teamId,
                ...filters,
                offset: query.offset,
                rowsPerPage: query.itemsPerPage,
            }),
            countTransactionalEmails(teamId, filters),
        ]);
        return {
            status: 200,
            body: {
                items: items.map(
                    (row) =>
                        toPublicTransactionalEmail(row, {
                            includeHtml: false,
                        }) as any,
                ),
                total,
            },
        };
    },
});

createExpressEndpoints(contract.transactional, impl, router);

export default router;
