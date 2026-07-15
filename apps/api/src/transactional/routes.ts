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

const router = Router();
router.use(requireAuth);
router.use(requireTeam);

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

router.use((req, res, next) => {
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
            });
            return {
                status: 202,
                body: { txeId: row.txeId, status: row.status as any },
            };
        } catch (err: any) {
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
                case "quota_exceeded":
                    return {
                        status: 429,
                        body: { error: "Mail sending quota exceeded" },
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
