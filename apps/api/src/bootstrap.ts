import logger from "./services/log";
import { createAccount, findAccountByEmail } from "./account/queries";

/**
 * If `SUPER_ADMIN_EMAIL` is set and no account exists for it yet,
 * create one (with its default team + API key) and log the key once so an
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
        const existing = await findAccountByEmail(email.toLowerCase());
        if (existing) return;

        const account = await createAccount(email.toLowerCase());

        // Keys are stored hashed, so this log line is the only place the
        // secret ever appears — exactly the "grab it from `docker compose
        // logs` once" flow described above.
        logger.info(
            {
                accountId: account.id,
                teamId: account.defaultTeamId,
                apiKey: account.defaultApiKeySecret,
            },
            "Super admin account created",
        );
    } catch (err: any) {
        logger.error(
            { error: err.message },
            "Failed to create super admin account",
        );
    }
}
