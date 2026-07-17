import express, { Router, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import {
    auth,
    ensureSendLitAccountForBetterAuthUserId,
    webClientUrl,
} from "./better-auth";
import {
    getOAuthTeamSelection,
    getTeamByTeamId,
    getTeamMembership,
    listTeamsForAccount,
    setOAuthTeamSelection,
    type Team,
} from "../team/queries";

/**
 * Self-hosted login/consent screens for Better Auth's OAuth Provider plugin
 * (`loginPage`/`consentPage`/`postLogin.page` in `./better-auth.ts`). Rendered
 * directly by this API — not `apps/web` — so a brand-new MCP/OAuth client can
 * complete its first-time authorization (login + team selection + consent)
 * even if the web dashboard isn't deployed at all. This mirrors how the
 * pre-Better-Auth custom OAuth2 server worked (see `git log` for the removed
 * `src/oauth/authorize-page.ts`): plain server-rendered HTML, no frontend
 * framework dependency.
 *
 * These pages are thin shells: all the real work (OTP send/verify, Google
 * sign-in, consent recording, token issuance) happens via `fetch` calls to
 * the same-origin `/api/auth/*` endpoints already mounted in `index.ts`.
 * Every submission forwards the current page's full query string back as
 * `oauth_query` — Better Auth signs that string when it first redirects here
 * and re-verifies the signature on every follow-up call, which is what lets
 * it resume the in-flight authorization after login/team-selection/consent
 * completes.
 *
 * `/oauth/select-team` (GET renders the picker, POST records the choice) is
 * the odd one out: it isn't a Better Auth-owned page at all, just a plain
 * session-authenticated Express route this file also happens to host,
 * because `postLogin.page` in `./better-auth.ts` needs *some* URL to send a
 * multi-team account to between login and consent — see that file's
 * `resolveOAuthTeamSelection` for how the choice recorded here ends up on
 * the minted access token.
 */
const router = Router();

/** Login/consent screens render account-linking and scope-grant UI and must
 * never be embeddable in a third-party iframe (see the PRD's Security
 * Requirements). */
function setFrameProtection(res: Response) {
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Safely embeds a string as a JS string literal inside an inline
 * `<script>` block — escapes `<` so a value like `.../"><script>` can't
 * break out of the tag, on top of JSON.stringify's own quote escaping. */
function toScriptLiteral(value: string): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Only ever used for the plain (non-OAuth) `/login` page's `redirect`
 * param — the OAuth flow's `/oauth/login` never takes one. Restricts it to
 * the configured web client's own origin so `/login` can't be used as an
 * open redirect off this API's domain. */
function isAllowedRedirect(url: string | undefined): url is string {
    if (!url) return false;
    try {
        return new URL(url).origin === new URL(webClientUrl).origin;
    } catch {
        return false;
    }
}

const SHARED_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #0b0b0b;
    color: #fff;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
}
.card { width: 100%; max-width: 380px; background: #111; border: 1px solid #262626; border-radius: 12px; padding: 32px; }
.logo { width: 36px; height: 36px; background: #fffcf8; color: #111; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px; margin: 0 auto 20px; }
h1 { font-size: 22px; font-weight: 600; text-align: center; margin-bottom: 8px; }
p.sub { color: #a3a3a3; font-size: 13px; text-align: center; margin-bottom: 24px; line-height: 1.5; }
.error { background: rgba(239, 68, 68, .12); color: #f87171; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 16px; display: none; }
label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: #e5e5e5; }
.field { margin-bottom: 16px; }
input { width: 100%; padding: 10px 14px; font-size: 15px; background: #181818; color: #fff; border: 1px solid #262626; border-radius: 8px; outline: none; }
input:focus { border-color: #8c7a6b; box-shadow: 0 0 0 2px rgba(140,122,107,.2); }
button { width: 100%; padding: 11px; font-size: 14px; font-weight: 500; border: none; border-radius: 8px; cursor: pointer; margin-top: 4px; }
.btn-primary { background: #8c7a6b; color: #fff; }
.btn-primary:hover { background: #7a6a5c; }
.btn-secondary { background: transparent; color: #a3a3a3; border: 1px solid #262626; }
.btn-outline { background: transparent; color: #fff; border: 1px solid #262626; }
button:disabled { opacity: .6; cursor: not-allowed; }
.divider { display: flex; align-items: center; gap: 10px; color: #737373; font-size: 12px; margin: 20px 0; }
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #262626; }
.scopes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.scope-badge { border: 1px solid #262626; background: #181818; border-radius: 6px; padding: 4px 8px; font-size: 12px; color: #a3a3a3; }
.client-box { border: 1px solid #262626; background: #181818; border-radius: 8px; padding: 12px; margin-bottom: 20px; }
.client-name { font-size: 14px; font-weight: 500; word-break: break-all; }
.team-name { font-size: 13px; color: #a3a3a3; margin-top: 4px; }
.actions { display: flex; gap: 8px; }
.actions button { margin-top: 0; }
.team-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; max-height: 320px; overflow-y: auto; }
.team-option { display: flex; align-items: center; gap: 10px; border: 1px solid #262626; background: #181818; border-radius: 8px; padding: 12px 14px; cursor: pointer; }
.team-option:has(input:checked) { border-color: #8c7a6b; box-shadow: 0 0 0 2px rgba(140,122,107,.2); }
.team-option input { width: auto; margin: 0; }
.team-option span { font-size: 14px; }
`;

function layout(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="card">
${body}
</div>
</body>
</html>`;
}

/** Shared by `/login` and `/oauth/login` — identical form, only the inline
 * `<script>` appended after it differs (see each route below). */
function loginFormMarkup(): string {
    return `
<div class="logo">S</div>
<h1>Sign in to SendLit</h1>
<p class="sub">We'll email you a one-time code &mdash; no password needed.</p>
<div class="error" id="error"></div>

<form id="email-form">
    <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email" placeholder="you@example.com">
    </div>
    <button type="submit" class="btn-primary">Continue with email</button>
</form>

<form id="otp-form" style="display:none">
    <div class="field">
        <label for="otp">Verification code</label>
        <input id="otp" inputmode="numeric" required autocomplete="one-time-code" placeholder="123456">
    </div>
    <button type="submit" class="btn-primary">Sign in</button>
    <button type="button" class="btn-secondary" id="use-different-email">Use a different email</button>
</form>

<div class="divider">or</div>
<button type="button" class="btn-outline" id="google-submit">Continue with Google</button>`;
}

/** Plain (non-OAuth) login, reached by `apps/web`'s `/login` redirect — see
 * the "Unified Login Screen" addendum in
 * `apps/api/docs/replace-oauth-server-with-better-auth.md`. Same page as
 * `/oauth/login` below; on success it navigates straight to the validated
 * `redirect` target instead of resuming an OAuth authorization. */
router.get("/login", (req, res) => {
    setFrameProtection(res);
    const requestedRedirect =
        typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const redirectTarget = isAllowedRedirect(requestedRedirect)
        ? requestedRedirect
        : `${webClientUrl}/`;
    const body = `${loginFormMarkup()}
<script>
(function () {
    var redirectTarget = ${toScriptLiteral(redirectTarget)};
    var errorCallbackURL = ${toScriptLiteral(
        `/login?error=oauth_failed&redirect=${encodeURIComponent(redirectTarget)}`,
    )};
    var params = new URLSearchParams(location.search);
    var emailForm = document.getElementById("email-form");
    var otpForm = document.getElementById("otp-form");
    var errorEl = document.getElementById("error");
    var emailInput = document.getElementById("email");
    var otpInput = document.getElementById("otp");
    var email = "";

    function showError(message) {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }
    function clearError() {
        errorEl.style.display = "none";
    }
    function setPending(form, pending) {
        var btns = form.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) btns[i].disabled = pending;
    }

    if (params.get("error")) {
        showError("Could not start Google sign-in. Please try again.");
    }

    async function postJson(path, body) {
        var res = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(body),
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) {
            throw new Error(data.message || data.error_description || data.error || "Request failed");
        }
        return data;
    }

    emailForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearError();
        setPending(emailForm, true);
        email = emailInput.value;
        try {
            await postJson("/api/auth/email-otp/send-verification-otp", {
                email: email,
                type: "sign-in",
            });
            emailForm.style.display = "none";
            otpForm.style.display = "block";
        } catch (err) {
            showError(err.message || "Could not send the code.");
        } finally {
            setPending(emailForm, false);
        }
    });

    otpForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearError();
        setPending(otpForm, true);
        try {
            await postJson("/api/auth/sign-in/email-otp", {
                email: email,
                otp: otpInput.value,
                name: email.split("@")[0],
            });
            location.assign(redirectTarget);
        } catch (err) {
            showError(err.message || "The code is invalid or expired.");
            setPending(otpForm, false);
        }
    });

    document.getElementById("use-different-email").addEventListener("click", function () {
        otpForm.style.display = "none";
        emailForm.style.display = "block";
        clearError();
    });

    document.getElementById("google-submit").addEventListener("click", async function () {
        clearError();
        var btn = document.getElementById("google-submit");
        btn.disabled = true;
        try {
            var data = await postJson("/api/auth/sign-in/social", {
                provider: "google",
                callbackURL: redirectTarget,
                errorCallbackURL: errorCallbackURL,
            });
            if (!data.url) throw new Error("Google sign-in is not configured.");
            location.assign(data.url);
        } catch (err) {
            showError(err.message || "Could not start Google sign-in.");
            btn.disabled = false;
        }
    });
})();
</script>`;
    res.type("html").send(layout("Sign in to SendLit", body));
});

router.get("/oauth/login", (_req, res) => {
    setFrameProtection(res);
    const body = `${loginFormMarkup()}
<script>
(function () {
    var oauthQuery = location.search.slice(1);
    var emailForm = document.getElementById("email-form");
    var otpForm = document.getElementById("otp-form");
    var errorEl = document.getElementById("error");
    var emailInput = document.getElementById("email");
    var otpInput = document.getElementById("otp");
    var email = "";

    function showError(message) {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }
    function clearError() {
        errorEl.style.display = "none";
    }
    function setPending(form, pending) {
        var btns = form.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) btns[i].disabled = pending;
    }

    function followRedirect(data) {
        var url = data.url || data.redirect_uri;
        if (!url) throw new Error("No redirect URL returned");
        location.assign(url);
    }

    async function postJson(path, body) {
        var res = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(body),
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) {
            throw new Error(data.message || data.error_description || data.error || "Request failed");
        }
        return data;
    }

    emailForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearError();
        setPending(emailForm, true);
        email = emailInput.value;
        try {
            await postJson("/api/auth/email-otp/send-verification-otp", {
                email: email,
                type: "sign-in",
                oauth_query: oauthQuery,
            });
            emailForm.style.display = "none";
            otpForm.style.display = "block";
        } catch (err) {
            showError(err.message || "Could not send the code.");
        } finally {
            setPending(emailForm, false);
        }
    });

    otpForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearError();
        setPending(otpForm, true);
        try {
            var data = await postJson("/api/auth/sign-in/email-otp", {
                email: email,
                otp: otpInput.value,
                name: email.split("@")[0],
                oauth_query: oauthQuery,
            });
            followRedirect(data);
        } catch (err) {
            showError(err.message || "The code is invalid or expired.");
            setPending(otpForm, false);
        }
    });

    document.getElementById("use-different-email").addEventListener("click", function () {
        otpForm.style.display = "none";
        emailForm.style.display = "block";
        clearError();
    });

    document.getElementById("google-submit").addEventListener("click", async function () {
        clearError();
        var btn = document.getElementById("google-submit");
        btn.disabled = true;
        try {
            var data = await postJson("/api/auth/sign-in/social", {
                provider: "google",
                oauth_query: oauthQuery,
            });
            if (!data.url) throw new Error("Google sign-in is not configured.");
            location.assign(data.url);
        } catch (err) {
            showError(err.message || "Could not start Google sign-in.");
            btn.disabled = false;
        }
    });
})();
</script>`;
    res.type("html").send(layout("Sign in to SendLit", body));
});

/** Fetches the caller's Better Auth session directly from the request
 * headers — same mechanism `resolve-auth.ts` uses for cookie-based session
 * auth, reused here because these two routes aren't behind `requireAuth`
 * (they're part of the OAuth interaction flow, reached by redirect, not by
 * an API caller that already has a bearer token). */
async function getRequestSession(req: any) {
    return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

/** True once an account has more than one team — the only case where a
 * choice is actually meaningful. Mirrors `resolveOAuthTeamSelection` in
 * `./better-auth.ts`, which is what actually gates whether this page is
 * ever reached. */
function needsTeamSelection(teams: Team[]): boolean {
    return teams.length > 1;
}

router.get("/oauth/select-team", async (req, res) => {
    setFrameProtection(res);
    const session = await getRequestSession(req);
    const oauthQuery = req.originalUrl.split("?")[1] || "";
    if (!session?.user) {
        // Shouldn't happen — `postLogin.page` only redirects here right
        // after login — but if the session cookie is missing or expired by
        // the time this loads, resume through login with the same query.
        res.redirect(`/oauth/login?${oauthQuery}`);
        return;
    }

    const account = await ensureSendLitAccountForBetterAuthUserId(
        session.user.id,
    );
    const teams = account ? await listTeamsForAccount(account.id) : [];
    if (!needsTeamSelection(teams)) {
        // Nothing to pick (account only has one team, or none) — this
        // shouldn't normally be reachable since `shouldRedirect` already
        // checks this, but resuming straight to consent (via the same
        // `oauth2/continue` call the picker below would otherwise make) is
        // the safe fallback rather than showing an empty picker. `continue`
        // is POST-only, so this can't be a plain redirect.
        const body = `
<div class="logo">S</div>
<h1>Continuing&hellip;</h1>
<div class="error" id="error"></div>
<script>
(function () {
    var oauthQuery = ${toScriptLiteral(oauthQuery)};
    fetch("/api/auth/oauth2/continue", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ postLogin: true, oauth_query: oauthQuery }),
    })
        .then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                return { ok: res.ok, data: data };
            });
        })
        .then(function (r) {
            var url = r.data.url || r.data.redirect_uri;
            if (!r.ok || !url) throw new Error(r.data.error_description || "Could not continue.");
            location.assign(url);
        })
        .catch(function (err) {
            var errorEl = document.getElementById("error");
            errorEl.textContent = err.message || "Could not continue.";
            errorEl.style.display = "block";
        });
})();
</script>`;
        res.type("html").send(layout("Continuing…", body));
        return;
    }

    // The picker only ever hands the *public* team handle to the browser —
    // `t.id` is the internal surrogate key and, per the convention documented
    // on `db/schema.ts`'s ID section, never leaves the server. The POST
    // handler below translates it back via `getTeamByTeamId`, same as any
    // other outer-edge entrypoint (route params, `X-Sendlit-Team-Id`).
    const teamOptions = teams
        .map(
            (t, i) => `<label class="team-option">
    <input type="radio" name="team" value="${escapeHtml(t.teamId)}"${i === 0 ? " checked" : ""}>
    <span>${escapeHtml(t.name)}</span>
</label>`,
        )
        .join("\n");

    const body = `
<div class="logo">S</div>
<h1>Select a team</h1>
<p class="sub">Choose which SendLit team to grant access to.</p>
<div class="error" id="error"></div>

<form id="team-form">
    <div class="team-list">
${teamOptions}
    </div>
    <button type="submit" class="btn-primary">Continue</button>
</form>

<script>
(function () {
    var oauthQuery = location.search.slice(1);
    var form = document.getElementById("team-form");
    var errorEl = document.getElementById("error");

    function showError(message) {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }

    async function postJson(path, body) {
        var res = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(body),
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) {
            throw new Error(data.message || data.error_description || data.error || "Request failed");
        }
        return data;
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        errorEl.style.display = "none";
        var selected = form.querySelector('input[name="team"]:checked');
        if (!selected) {
            showError("Choose a team to continue.");
            return;
        }
        var btn = form.querySelector("button");
        btn.disabled = true;
        try {
            await postJson("/oauth/select-team", { teamId: selected.value });
            var data = await postJson("/api/auth/oauth2/continue", {
                postLogin: true,
                oauth_query: oauthQuery,
            });
            var url = data.url || data.redirect_uri;
            if (!url) throw new Error("No redirect URL returned");
            location.assign(url);
        } catch (err) {
            showError(err.message || "Could not continue.");
            btn.disabled = false;
        }
    });
})();
</script>`;
    res.type("html").send(layout("Select a team", body));
});

router.post("/oauth/select-team", express.json(), async (req, res) => {
    setFrameProtection(res);
    const session = await getRequestSession(req);
    if (!session?.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    const account = await ensureSendLitAccountForBetterAuthUserId(
        session.user.id,
    );
    if (!account) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    const publicTeamId =
        typeof req.body?.teamId === "string" ? req.body.teamId : undefined;
    if (!publicTeamId) {
        res.status(400).json({
            error: "invalid_request",
            error_description: "teamId is required",
        });
        return;
    }

    const team = await getTeamByTeamId(publicTeamId);
    if (!team) {
        res.status(400).json({
            error: "invalid_team_id",
            error_description: "The provided team ID is not valid.",
        });
        return;
    }

    const membership = await getTeamMembership(team.id, account.id);
    if (!membership) {
        res.status(403).json({
            error: "not_a_team_member",
            error_description: "You are not a member of this team.",
        });
        return;
    }

    await setOAuthTeamSelection(session.session.id, team.id);
    res.json({ ok: true });
});

router.get("/oauth/consent", async (req, res) => {
    setFrameProtection(res);
    const clientId =
        typeof req.query.client_id === "string"
            ? req.query.client_id
            : "OAuth client";
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    const scopes = scope.split(/\s+/).filter(Boolean);
    const scopeBadges = scopes
        .map((s) => `<span class="scope-badge">${escapeHtml(s)}</span>`)
        .join("");

    // Purely informational — shows which team is about to be granted access,
    // mirroring how Notion's own consent screen keeps the picked workspace
    // visible through to the final step. The actual team was already
    // recorded via `/oauth/select-team` (or there's only one, and no
    // selection was ever needed); this never changes what gets granted.
    const session = await getRequestSession(req);
    let teamName: string | undefined;
    if (session?.user) {
        const account = await ensureSendLitAccountForBetterAuthUserId(
            session.user.id,
        );
        if (account) {
            const [teams, selectedTeamId] = await Promise.all([
                listTeamsForAccount(account.id),
                getOAuthTeamSelection(session.session.id),
            ]);
            const team = needsTeamSelection(teams)
                ? teams.find((t) => t.id === selectedTeamId)
                : teams[0];
            teamName = team?.name;
        }
    }

    const body = `
<div class="logo">S</div>
<h1>Authorize SendLit access</h1>
<p class="sub">Review the client and scopes before continuing.</p>
<div class="error" id="error"></div>

<div class="client-box">
    <div class="client-name">${escapeHtml(clientId)}</div>
    ${teamName ? `<div class="team-name">Team: ${escapeHtml(teamName)}</div>` : ""}
    ${scopes.length ? `<div class="scopes">${scopeBadges}</div>` : ""}
</div>

<div class="actions">
    <button type="button" class="btn-primary" id="allow">Allow</button>
    <button type="button" class="btn-outline" id="deny">Deny</button>
</div>

<script>
(function () {
    var oauthQuery = location.search.slice(1);
    var errorEl = document.getElementById("error");
    var allowBtn = document.getElementById("allow");
    var denyBtn = document.getElementById("deny");

    function showError(message) {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }

    async function decide(accept) {
        errorEl.style.display = "none";
        allowBtn.disabled = true;
        denyBtn.disabled = true;
        try {
            var res = await fetch("/api/auth/oauth2/consent", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ accept: accept, oauth_query: oauthQuery }),
            });
            var data = {};
            try { data = await res.json(); } catch (e) {}
            if (!res.ok) {
                throw new Error(data.message || data.error_description || data.error || "Consent failed");
            }
            var url = data.url || data.redirect_uri;
            if (!url) throw new Error("No redirect URL returned");
            location.assign(url);
        } catch (err) {
            showError(err.message || "Could not complete authorization.");
            allowBtn.disabled = false;
            denyBtn.disabled = false;
        }
    }

    allowBtn.addEventListener("click", function () { decide(true); });
    denyBtn.addEventListener("click", function () { decide(false); });
})();
</script>`;
    res.type("html").send(layout("Authorize SendLit access", body));
});

export default router;
