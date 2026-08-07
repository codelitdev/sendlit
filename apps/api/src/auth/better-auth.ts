import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createOAuthProviderOptions } from "@codelitdev/oauth-server-kit/better-auth";
import type { HostedLoginMethod } from "@codelitdev/oauth-server-kit/express";
import { createTransport } from "nodemailer";
import { db } from "../db/client";
import * as schema from "../db/schema";
import logger from "../services/log";
import { ensureDefaultOrganization } from "../organization/queries";
import {
    createSendLitOAuthTeamSelectionHooks,
    oauthTeamSelectionAdapter,
} from "./oauth-team-selection";

export const webClientUrl = process.env.WEB_CLIENT || "http://localhost:3000";
const apiUrl = process.env.API_PUBLIC_URL || process.env.BETTER_AUTH_URL;
const authBaseUrl = apiUrl || "http://localhost:5000";
export const authBasePath = "/api/auth";

/** Parent domain shared by `apps/web` and `apps/api` in production (e.g.
 * `sendlit.example.com`, covering both `app.sendlit.example.com` and
 * `api.sendlit.example.com`). When set, the session cookie is scoped to this
 * domain instead of being host-only, so a session established on either
 * subdomain's login page is valid on both — see the "Unified Login Screen"
 * addendum in `apps/api/docs/replace-oauth-server-with-better-auth.md`.
 * Left unset in local dev: `localhost` cookies already aren't port-scoped, so
 * `apps/web` (3000) and `apps/api` (4000) already share a cookie jar. */
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

/** The actual `iss` Better Auth puts on every JWT it signs is
 * `baseURL + basePath` (i.e. `ctx.context.baseURL`), not just `baseURL` —
 * confirmed against this server's own `/.well-known/oauth-authorization-server`
 * (`issuer` there is `http://localhost:5000/api/auth`, not `http://localhost:5000`).
 * `resolve-auth.ts` must verify against this same value or every bearer
 * token gets rejected with `invalid_token` regardless of anything else. */
export const authIssuer = `${authBaseUrl}${authBasePath}`;

/** The MCP resource identifier advertised in protected-resource metadata
 * (`mcp/routes.ts`). Spec-compliant OAuth/MCP clients request an access
 * token scoped to this exact `resource`/`aud` value. */
export const mcpResourceUrl = `${authBaseUrl}/mcp`;

/** Every `resource`/`aud` value the oauth-provider plugin will accept and
 * therefore every value `resolve-auth.ts` must accept back when verifying —
 * single source of truth shared between `oauthProvider({ validAudiences })`
 * below and `resolve-auth.ts`'s bearer verification. */
export const validOAuthAudiences = [authBaseUrl, mcpResourceUrl];

/** Where an MCP client should discover `mcpResourceUrl`'s protected-resource
 * metadata (RFC 9728: `<origin>/.well-known/oauth-protected-resource<path>`).
 * Sent back as the `WWW-Authenticate: Bearer resource_metadata="..."` challenge
 * on 401s from `/mcp` (see `auth/middleware.ts`) — without this, spec-compliant
 * clients have no way to discover it and never learn to request a token with
 * `resource=mcpResourceUrl`, so Better Auth mints an opaque (non-JWT) token
 * that this API can't verify at all. */
export const mcpProtectedResourceMetadataUrl = `${authBaseUrl}/.well-known/oauth-protected-resource/mcp`;

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

async function sendOtpEmail(email: string, otp: string) {
    if (process.env.NODE_ENV !== "production") {
        logger.info({ email, otp }, "[Dev] Better Auth OTP generated");
        return;
    }

    // Platform SMTP for login OTPs. Host is required; user/pass are optional so
    // auth-less sinks (Mailpit, local smtp4dev) work without dummy credentials.
    if (!process.env.EMAIL_HOST) {
        logger.error(
            { email },
            "Cannot send OTP email: SMTP is not configured",
        );
        return;
    }

    const transporter = createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        auth: process.env.EMAIL_USER
            ? {
                  user: process.env.EMAIL_USER,
                  pass: process.env.EMAIL_PASS || "",
              }
            : undefined,
    });

    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Your SendLit verification code",
        text: `Enter this code to sign in to SendLit: ${otp}`,
        html: `<p>Enter this code to sign in to SendLit:</p><h2>${otp}</h2>`,
    });
}

export { oauthTeamSelectionAdapter };

export const hostedLoginMethods: HostedLoginMethod[] = [
    { type: "email-otp" },
    ...(googleClientId && googleClientSecret
        ? [
              {
                  type: "social" as const,
                  providerId: "google",
                  label: "Continue with Google",
              },
          ]
        : []),
];

export const auth = betterAuth({
    appName: "SendLit",
    baseURL: authBaseUrl,
    basePath: authBasePath,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
    trustedOrigins: [webClientUrl, authBaseUrl],
    advanced: authCookieDomain
        ? {
              crossSubDomainCookies: {
                  enabled: true,
                  domain: authCookieDomain,
              },
          }
        : undefined,
    user: {
        additionalFields: {
            defaultOrganizationId: {
                type: "string",
                required: false,
                input: false,
            },
        },
    },
    session: {
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
    },
    socialProviders:
        googleClientId && googleClientSecret
            ? {
                  google: {
                      clientId: googleClientId,
                      clientSecret: googleClientSecret,
                  },
              }
            : undefined,
    databaseHooks: {
        user: {
            create: {
                async after(user) {
                    await ensureDefaultOrganization(user.id);
                },
            },
        },
    },
    plugins: [
        emailOTP({
            async sendVerificationOTP({ email, otp }) {
                await sendOtpEmail(email, otp);
            },
            storeOTP: "hashed",
            expiresIn: 5 * 60,
            allowedAttempts: 5,
            rateLimit: {
                window: 60,
                max: 3,
            },
        }),
        jwt(),
        oauthProvider({
            ...createOAuthProviderOptions({
                loginPage: `${authBaseUrl}/oauth/login`,
                consentPage: `${authBaseUrl}/oauth/consent`,
                // MCP clients may register their own public OAuth client.
                // Registration is constrained to SendLit's supported scopes.
                allowDynamicClientRegistration: true,
                allowUnauthenticatedDynamicClientRegistration: true,
                scopes: [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "contacts:read",
                    "contacts:write",
                    "templates:read",
                    "templates:write",
                    "media:read",
                    "media:write",
                    "broadcasts:write",
                    "sequences:read",
                    "sequences:write",
                ],
                validAudiences: validOAuthAudiences,
                clientRegistrationDefaultScopes: ["openid", "profile", "email"],
                clientRegistrationAllowedScopes: [
                    "offline_access",
                    "contacts:read",
                    "contacts:write",
                    "templates:read",
                    "templates:write",
                    "media:read",
                    "media:write",
                    "broadcasts:write",
                    "sequences:read",
                    "sequences:write",
                ],
            }),
            ...createSendLitOAuthTeamSelectionHooks({
                page: `${authBaseUrl}/oauth/select-team`,
                adapter: oauthTeamSelectionAdapter,
            }),
        }),
    ],
});

export const oauthResourceClient = oauthProviderResourceClient(auth);
