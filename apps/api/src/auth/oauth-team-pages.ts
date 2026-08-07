import { fromNodeHeaders } from "better-auth/node";
import express, {
    Router,
    type NextFunction,
    type Request,
    type RequestHandler,
    type Response,
} from "express";
import type { SendLitOAuthTeamSelectionAdapter } from "./oauth-team-selection";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function page(body: string) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Select a SendLit team</title></head><body><main>${body}</main></body></html>`;
}

function asyncHandler(
    handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
    return (request, response, next: NextFunction) => {
        void handler(request, response).catch(next);
    };
}

export function createSendLitOAuthTeamPages(options: {
    auth: {
        api: {
            getSession(input: { headers: Headers }): Promise<{
                user: { id: string };
                session: { id: string };
            } | null>;
        };
    };
    adapter: SendLitOAuthTeamSelectionAdapter;
    authBasePath: string;
}) {
    const router = Router();

    router.use("/oauth/select-team", (_request, response, next) => {
        response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("X-Content-Type-Options", "nosniff");
        next();
    });

    router.get(
        "/oauth/select-team",
        asyncHandler(async (request, response) => {
            const session = await options.auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
            const oauthQuery = request.originalUrl.split("?")[1] ?? "";
            if (!session?.user) {
                response.redirect(`/oauth/login?${oauthQuery}`);
                return;
            }
            const teams = await options.adapter.listTeamsForUser(
                session.user.id,
            );
            if (teams.length <= 1) {
                response
                    .type("html")
                    .send(
                        page(
                            `<h1>Continuing&hellip;</h1><script>(async function(){var response=await fetch(${JSON.stringify(`${options.authBasePath}/oauth2/continue`)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({postLogin:true,oauth_query:${JSON.stringify(oauthQuery)}})});var data=await response.json();location.assign(data.url||data.redirect_uri)})();</script>`,
                        ),
                    );
                return;
            }
            const choices = teams
                .map(
                    (team, index) =>
                        `<label class="team-option"><input type="radio" name="team" value="${escapeHtml(team.publicId)}"${index === 0 ? " checked" : ""}>${escapeHtml(team.name)}</label>`,
                )
                .join("");
            response
                .type("html")
                .send(
                    page(
                        `<h1>Select a team</h1><form id="team-form">${choices}<button type="submit">Continue</button></form><div id="error"></div><script>(function(){var form=document.getElementById("team-form");form.addEventListener("submit",async function(event){event.preventDefault();var selected=form.querySelector('input[name="team"]:checked');if(!selected)return;var save=await fetch("/oauth/select-team",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({teamId:selected.value})});if(!save.ok)return;var response=await fetch(${JSON.stringify(`${options.authBasePath}/oauth2/continue`)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({postLogin:true,oauth_query:location.search.slice(1)})});var data=await response.json();location.assign(data.url||data.redirect_uri)})})();</script>`,
                    ),
                );
        }),
    );

    router.post(
        "/oauth/select-team",
        express.json(),
        asyncHandler(async (request, response) => {
            const session = await options.auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
            if (!session?.user) {
                response.status(401).json({ error: "unauthorized" });
                return;
            }
            const teamId =
                typeof request.body?.teamId === "string"
                    ? request.body.teamId
                    : undefined;
            if (!teamId) {
                response.status(400).json({
                    error: "invalid_request",
                    error_description: "teamId is required",
                });
                return;
            }
            const teams = await options.adapter.listTeamsForUser(
                session.user.id,
            );
            const selected = teams.find((team) => team.publicId === teamId);
            if (!selected) {
                response.status(403).json({
                    error: "not_a_team_member",
                    error_description: "You are not a member of this team.",
                });
                return;
            }
            await options.adapter.setSelectedTeamId(
                session.session.id,
                selected.id,
            );
            response.json({ ok: true });
        }),
    );

    return router;
}
