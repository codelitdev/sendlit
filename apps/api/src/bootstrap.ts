import { randomUUID } from "crypto";
import { createOrganizationApiKey } from "./apikey/queries";
import { db } from "./db/client";
import { user } from "./db/schema";
import { ensureDefaultOrganization } from "./organization/queries";
import logger from "./services/log";
import { findUserByEmail } from "./user/queries";

/**
 * If `SUPER_ADMIN_EMAIL` is set and no user exists for it yet, create the
 * Better Auth user and default organization, then log an organization key once
 * so an
 * operator bringing the stack up via `docker compose` can grab it from
 * `docker compose logs` without any manual OAuth sign-in step.
 *
 * This only ever provisions *one* team, once, at container start — it's a
 * dev/self-host convenience, not how a multi-tenant consumer (e.g. CourseLit,
 * creating a team per one of its own tenants, at any point after boot) should
 * provision teams. See `provisioning/routes.ts` for that.
 */
export async function createSuperAdminIfMissing(): Promise<void> {
    const email = process.env.SUPER_ADMIN_EMAIL;
    if (!email) return;

    try {
        const normalizedEmail = email.toLowerCase();
        const existing = await findUserByEmail(normalizedEmail);
        if (existing) return;

        const now = new Date();
        const [identity] = await db
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
        const organization = await ensureDefaultOrganization(identity.id);
        if (!organization) throw new Error("organization_bootstrap_failed");
        const { secret } = await createOrganizationApiKey(
            organization.id,
            "Bootstrap",
            [
                "organization:read",
                "teams:provision",
                "teams:read",
                "teams:manage",
                "teams:keys",
                "esps:read",
                "esps:manage",
                "grants:manage",
                "usage:read",
            ],
            identity.id,
        );

        // Keys are stored hashed, so this log line is the only place the
        // secret ever appears — exactly the "grab it from `docker compose
        // logs` once" flow described above.
        logger.info(
            {
                userId: identity.id,
                organizationId: organization.organizationId,
                organizationApiKey: secret,
            },
            "Super admin user and organization created",
        );
    } catch (err: any) {
        logger.error(
            { error: err.message },
            "Failed to create super admin user",
        );
        throw err;
    }
}
