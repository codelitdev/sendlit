import { cimd } from "@better-auth/cimd";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createOAuthProviderOptions } from "@codelitdev/oauth-server-kit/better-auth";
import type { HostedLoginMethod } from "@codelitdev/oauth-server-kit/express";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { createTransport } from "nodemailer";
import {
  assertSignupAllowed,
  CLIENT_IP_HEADER,
  isExistingUser,
  recordSignup,
  SignupBlockedError,
} from "../abuse/signup";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { MCP_SCOPES_SUPPORTED } from "../mcp/policy";
import { captureError } from "../observability";
import { ensureDefaultOrganization } from "../organization/queries";
import logger from "../services/log";
import { fetchClientMetadataResource } from "./cimd-fetch";
import {
  createSendLitOAuthTeamSelectionHooks,
  oauthTeamSelectionAdapter,
} from "./oauth-team-selection";

export const webClientUrl = process.env.WEB_CLIENT || "http://localhost:3000";
const apiUrl = process.env.API_PUBLIC_URL || process.env.BETTER_AUTH_URL;
const authBaseUrl = apiUrl || "http://localhost:5000";
/** The client IP the API stamped on the auth request (see `app.ts`). */
function clientIp(
  context: { request?: Request; headers?: Headers } | null | undefined,
): string | null {
  return (
    context?.request?.headers.get(CLIENT_IP_HEADER) ??
    context?.headers?.get(CLIENT_IP_HEADER) ??
    null
  );
}

async function guardSignup(email: string, ip: string | null): Promise<void> {
  try {
    await assertSignupAllowed({ email, ip });
  } catch (error) {
    if (error instanceof SignupBlockedError) {
      throw new APIError("FORBIDDEN", {
        code: error.code.toUpperCase(),
        message: error.userMessage,
      });
    }
    throw error;
  }
}

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
/** Product-specific Better Auth cookie prefix (Platform AGENTS.md), so SendLit
 * and other CodeLit products on one hostname keep separate sessions. */
export const AUTH_COOKIE_PREFIX = "sendlit";
/** Session cookie name; Better Auth adds `__Secure-` over HTTPS. */
export const SESSION_COOKIE_NAME = `${AUTH_COOKIE_PREFIX}.session_token`;
export const validOAuthAudiences = [authBaseUrl, mcpResourceUrl];
export const OAUTH_CLIENT_DEFAULT_SCOPES = ["openid", "profile", "email"] as const;
export const OAUTH_CLIENT_REQUESTABLE_SCOPES = [
  "offline_access",
  ...MCP_SCOPES_SUPPORTED,
] as const;
const supportedOAuthScopes = [
  ...OAUTH_CLIENT_DEFAULT_SCOPES,
  ...OAUTH_CLIENT_REQUESTABLE_SCOPES,
] as const;

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
    logger.error({ email }, "Cannot send OTP email: SMTP is not configured");
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
  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
    ...(authCookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: authCookieDomain,
          },
        }
      : {}),
  },
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
        // Hosted signup guards (#71) also cover Google sign-ups, which never
        // pass through the email OTP endpoints below.
        async before(user, context) {
          await guardSignup(user.email, clientIp(context));
        },
        async after(user, context) {
          const organization = await ensureDefaultOrganization(user.id);
          await recordSignup({
            userId: user.id,
            email: user.email,
            organizationId: organization?.id ?? null,
            ip: clientIp(context),
          }).catch((error) =>
            captureError({
              error,
              source: "abuse.record_signup",
              context: { organization_id: organization?.id },
            }),
          );
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      // Refuse a new account before its sign-in code is even sent.
      if (
        context.path === "/email-otp/send-verification-otp" ||
        context.path === "/sign-in/email-otp"
      ) {
        const email = (context.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && !(await isExistingUser(email))) {
          await guardSignup(email, clientIp(context));
        }
        return;
      }
      if (context.path !== "/oauth2/authorize") return;

      const scope = context.query?.scope;
      if (typeof scope === "string" && scope.trim().length > 0) return;

      // Better Auth persists the union of registration defaults and
      // allowed scopes as the client's capability set, then treats that
      // complete set as requested when `scope` is omitted. Require an
      // explicit choice so a scope-less request can never become a
      // full-access MCP grant.
      throw new APIError("BAD_REQUEST", {
        error: "invalid_scope",
        error_description:
          "OAuth authorization requests must include an explicit scope.",
      });
    }),
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
        // Prefer CIMD for modern clients, while retaining public DCR
        // for existing MCP clients such as Inspector. Registration
        // creates only a public OAuth client; user authentication,
        // consent, resource binding, PKCE, and scope enforcement still
        // apply before any access token is issued.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedDynamicClientRegistration: true,
        scopes: supportedOAuthScopes,
        validAudiences: validOAuthAudiences,
        // Registration establishes capabilities, not grants. Keep the
        // default set identity-only and allow clients to explicitly
        // request the narrower MCP scope set they present at consent.
        clientRegistrationDefaultScopes: OAUTH_CLIENT_DEFAULT_SCOPES,
        clientRegistrationAllowedScopes: OAUTH_CLIENT_REQUESTABLE_SCOPES,
      }),
      // The authorization request's RFC 8707 `resource` value must
      // resolve to a persisted provider resource. Seed the sole current
      // remote-MCP resource and link it to CIMD clients at registration.
      resources: [
        {
          identifier: mcpResourceUrl,
          name: "SendLit MCP",
          allowedScopes: [...MCP_SCOPES_SUPPORTED],
        },
      ],
      clientRegistrationDefaultResources: [mcpResourceUrl],
      // The kit allows every valid audience; registered clients only ever
      // target the MCP resource, which is the only one seeded above.
      clientRegistrationAllowedResources: [mcpResourceUrl],
      ...createSendLitOAuthTeamSelectionHooks({
        page: `${authBaseUrl}/oauth/select-team`,
        adapter: oauthTeamSelectionAdapter,
      }),
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
      metadataRevalidationInterval: "60m",
      // VS Code serves its canonical CIMD document with `no-store`.
      // OAuth must then fetch it once for authorization and again
      // immediately for the authorization-code token exchange. Better
      // Auth's one-second default rejects that required second fetch as
      // temporarily_unavailable; retain its concurrency/rate budgets
      // but allow the same flow to revalidate without a delay.
      metadataFetchPolicy: {
        minimumFetchInterval: 0,
      },
      originBoundFields: ["post_logout_redirect_uris", "client_uri"],
    }),
  ],
});

export const oauthResourceClient = oauthProviderResourceClient(auth);
