import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { eq } from "drizzle-orm";
import { createTransport } from "nodemailer";
import { db } from "../db/client";
import * as schema from "../db/schema";
import logger from "../services/log";
import { createAccount, findAccountByEmail } from "../account/queries";

const webClientUrl = process.env.WEB_CLIENT || "http://localhost:3000";
const apiUrl = process.env.API_PUBLIC_URL || process.env.BETTER_AUTH_URL;
const authBaseUrl = apiUrl || "http://localhost:4000";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

async function sendOtpEmail(email: string, otp: string) {
    if (process.env.NODE_ENV !== "production") {
        logger.info({ email, otp }, "[Dev] Better Auth OTP generated");
        return;
    }

    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
        logger.error(
            { email },
            "Cannot send OTP email: SMTP is not configured",
        );
        return;
    }

    const transporter = createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Your SendLit verification code",
        text: `Enter this code to sign in to SendLit: ${otp}`,
        html: `<p>Enter this code to sign in to SendLit:</p><h2>${otp}</h2>`,
    });
}

export async function ensureSendLitAccountForUser(user: {
    email: string;
    name?: string | null;
}) {
    const email = user.email.toLowerCase();
    const existing = await findAccountByEmail(email);
    if (existing) return existing;

    return createAccount(email, user.name || undefined);
}

export async function ensureSendLitAccountForBetterAuthUserId(userId: string) {
    const [user] = await db
        .select()
        .from(schema.authUser)
        .where(eq(schema.authUser.id, userId))
        .limit(1);

    if (!user) return null;
    return ensureSendLitAccountForUser({
        email: user.email,
        name: user.name,
    });
}

export const auth = betterAuth({
    appName: "SendLit",
    baseURL: authBaseUrl,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
    trustedOrigins: [webClientUrl, authBaseUrl],
    user: {
        modelName: "authUser",
    },
    session: {
        modelName: "authSession",
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
    },
    account: {
        modelName: "authAccount",
    },
    verification: {
        modelName: "authVerification",
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
                    if (user.email) {
                        await ensureSendLitAccountForUser({
                            email: user.email,
                            name: user.name,
                        });
                    }
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
            schema: {
                oauthClient: {
                    modelName: "authOAuthClient",
                },
                oauthAccessToken: {
                    modelName: "authOAuthAccessToken",
                },
                oauthRefreshToken: {
                    modelName: "authOAuthRefreshToken",
                },
                oauthConsent: {
                    modelName: "authOAuthConsent",
                },
            },
            loginPage: `${webClientUrl}/login`,
            consentPage: `${webClientUrl}/oauth/consent`,
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            scopes: [
                "openid",
                "profile",
                "email",
                "offline_access",
                "contacts:read",
                "contacts:write",
                "templates:read",
                "templates:write",
                "broadcasts:write",
                "sequences:read",
                "sequences:write",
            ],
            validAudiences: [authBaseUrl, `${authBaseUrl}/mcp`],
        }),
    ],
});

export const oauthResourceClient = oauthProviderResourceClient(auth);
