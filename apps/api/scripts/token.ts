import "dotenv/config";

import { eq } from "drizzle-orm";
import { auth, authIssuer, validOAuthAudiences } from "../src/auth/better-auth";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { findAccountByEmail } from "../src/account/queries";
import { getTeamByTeamId, listTeamsForAccount } from "../src/team/queries";

const DEFAULT_SCOPES = [
    "openid",
    "profile",
    "email",
    "contacts:read",
    "contacts:write",
    "templates:read",
    "templates:write",
    "broadcasts:write",
    "sequences:read",
    "sequences:write",
];

function usage(): never {
    console.error("Usage: token <email> [--team team_...]");
    process.exit(1);
}

function parseArgs(argv: string[]) {
    const [email, ...rest] = argv;
    if (!email || email.startsWith("-")) usage();

    let teamId: string | undefined;
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === "--team") {
            teamId = rest[i + 1];
            if (!teamId) usage();
            i += 1;
            continue;
        }
        usage();
    }

    return { email: email.toLowerCase(), teamId };
}

async function findAuthUserByEmail(email: string) {
    const [user] = await db
        .select()
        .from(schema.authUser)
        .where(eq(schema.authUser.email, email))
        .limit(1);
    return user ?? null;
}

async function validateTeam(accountId: string, teamId?: string) {
    const teams = await listTeamsForAccount(accountId);

    if (teamId) {
        const team = await getTeamByTeamId(teamId);
        if (!team || !teams.some((candidate) => candidate.id === team.id)) {
            throw new Error(`Account is not a member of team ${teamId}.`);
        }
        return;
    }

    if (teams.length === 0) {
        throw new Error("Account does not belong to any team.");
    }

    if (teams.length > 1) {
        const choices = teams
            .map((team) => `${team.teamId} (${team.name})`)
            .join(", ");
        throw new Error(
            `Account belongs to multiple teams. Pass --team. Teams: ${choices}`,
        );
    }
}

async function main() {
    const { email, teamId } = parseArgs(process.argv.slice(2));

    const [account, authUser] = await Promise.all([
        findAccountByEmail(email),
        findAuthUserByEmail(email),
    ]);

    if (!account) {
        throw new Error(`No SendLit account exists for ${email}.`);
    }

    if (!authUser) {
        throw new Error(
            `No Better Auth user exists for ${email}. Sign in once before requesting an OAuth token.`,
        );
    }

    await validateTeam(account.id, teamId);

    const now = Math.floor(Date.now() / 1000);
    const response = await auth.api.signJWT({
        body: {
            payload: {
                sub: authUser.id,
                aud: validOAuthAudiences[0],
                azp: "sendlit-local-token",
                scope: DEFAULT_SCOPES.join(" "),
                iss: authIssuer,
                iat: now,
                exp: now + 60 * 60,
            },
        },
    });

    process.stdout.write(`${response.token}\n`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
