import { Router, Response } from "express";

/**
 * Self-hosted login/consent screens for Better Auth's OAuth Provider plugin
 * (`loginPage`/`consentPage` in `./better-auth.ts`). Rendered directly by
 * this API — not `apps/web` — so a brand-new MCP/OAuth client can complete
 * its first-time authorization (login + consent) even if the web dashboard
 * isn't deployed at all. This mirrors how the pre-Better-Auth custom OAuth2
 * server worked (see `git log` for the removed `src/oauth/authorize-page.ts`):
 * plain server-rendered HTML, no frontend framework dependency.
 *
 * Both pages are thin shells: all the real work (OTP send/verify, Google
 * sign-in, consent recording, token issuance) happens via `fetch` calls to
 * the same-origin `/api/auth/*` endpoints already mounted in `index.ts`.
 * Every submission forwards the current page's full query string back as
 * `oauth_query` — Better Auth signs that string when it first redirects here
 * and re-verifies the signature on every follow-up call, which is what lets
 * it resume the in-flight authorization after login/consent completes.
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
.actions { display: flex; gap: 8px; }
.actions button { margin-top: 0; }
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

router.get("/oauth/login", (_req, res) => {
    setFrameProtection(res);
    const body = `
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
<button type="button" class="btn-outline" id="google-submit">Continue with Google</button>

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

router.get("/oauth/consent", (req, res) => {
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

    const body = `
<div class="logo">S</div>
<h1>Authorize SendLit access</h1>
<p class="sub">Review the client and scopes before continuing.</p>
<div class="error" id="error"></div>

<div class="client-box">
    <div class="client-name">${escapeHtml(clientId)}</div>
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
