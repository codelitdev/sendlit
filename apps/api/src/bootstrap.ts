import { randomUUID } from "crypto";
import { registerConfiguredOrganizationApiKey } from "./apikey/queries";
import { db } from "./db/client";
import { user } from "./db/schema";
import {
    ensureDefaultOrganization,
    getOrganizationMembership,
} from "./organization/queries";
import logger from "./services/log";
import { findUserByEmail } from "./user/queries";

/**
 * Ensure the configured initial organization owner and their default
 * organization exist, then register any configured, pre-generated keys.
 * Plaintext keys come from configured environment variables and are never
 * logged.
 *
 * This only ever provisions *one* team, once, at container start — it's a
 * dev/self-host convenience, not how a multi-tenant consumer (e.g. CourseLit,
 * creating a team per one of its own tenants, at any point after boot) should
 * provision teams. See `provisioning/routes.ts` for that.
 */
export async function createInitialOrganizationOwnerIfMissing(): Promise<void> {
    const email = process.env.BOOTSTRAP_ORGANIZATION_OWNER_EMAIL;
    const configuredKeys = [
        {
            secret: process.env.BOOTSTRAP_DELIVERY_SETUP_API_KEY?.trim(),
            name: "[Auto-generated] Delivery Setup",
            scopes: [
                "organization:read",
                "esps:read",
                "esps:manage",
                "delivery:read",
                "delivery:manage",
            ],
        },
        {
            secret: process.env.BOOTSTRAP_TEAM_PROVISIONING_API_KEY?.trim(),
            name: "[Auto-generated] Team Provisioning",
            scopes: ["organization:read", "teams:provision", "teams:read"],
        },
    ].flatMap((key) => {
        const secret = key.secret?.trim();
        return secret ? [{ ...key, secret }] : [];
    });

    if (!email) {
        if (configuredKeys.length > 0) {
            throw new Error("initial_organization_owner_email_required");
        }
        return;
    }

    try {
        const normalizedEmail = email.toLowerCase();
        let identity = await findUserByEmail(normalizedEmail);
        if (!identity) {
            const now = new Date();
            const [createdIdentity] = await db
                .insert(user)
                .values({
                    id: randomUUID(),
                    email: normalizedEmail,
                    name: normalizedEmail.split("@")[0],
                    emailVerified: false,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning();
            if (!createdIdentity) {
                throw new Error("initial_organization_owner_create_failed");
            }
            identity = createdIdentity;
        }
        const organization = await ensureDefaultOrganization(identity.id);
        if (!organization) throw new Error("organization_bootstrap_failed");
        const membership = await getOrganizationMembership(
            organization.id,
            identity.id,
        );
        if (membership?.role !== "owner") {
            throw new Error("initial_organization_owner_required");
        }

        const registeredKeys = [];
        for (const key of configuredKeys) {
            const registration = await registerConfiguredOrganizationApiKey(
                organization.id,
                key.name,
                key.scopes,
                key.secret,
                identity.id,
            );
            registeredKeys.push({
                name: key.name,
                keyId: registration.apiKey.organizationApiKeyId,
                created: registration.created,
            });
        }

        logger.info(
            {
                userId: identity.id,
                organizationId: organization.organizationId,
                registeredKeys,
            },
            "Initial organization bootstrap completed",
        );
    } catch (err: any) {
        logger.error(
            { error: err.message },
            "Failed to create initial organization owner",
        );
        throw err;
    }
}
