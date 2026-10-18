import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import {
    espFeedbackConnections,
    organizationAuditEvents,
    organizationMembers,
    outboundMessages,
    sendingDomains,
    teams,
    user,
} from "../db/schema";
import { PlanGateError } from "./errors";

function verificationKey(): string {
    const key =
        process.env.BILLING_DOMAIN_VERIFICATION_KEY ||
        process.env.BETTER_AUTH_SECRET;
    if (!key) throw new Error("BILLING_DOMAIN_VERIFICATION_KEY_missing");
    return key;
}

export function normalizeSendingDomain(input: string): string {
    const value = input.trim().toLowerCase().replace(/\.$/, "");
    if (!value || value.includes("*") || /[:\/\s]/.test(value) || isIP(value))
        throw new Error("domain_invalid");
    let ascii: string;
    try {
        const parsed = new URL(`http://${value}`);
        // URL parsing is useful for IDNA conversion, but it otherwise accepts
        // userinfo, ports, paths, and query fragments. None of those are a
        // DNS domain and accepting them would verify a different hostname.
        if (
            parsed.username ||
            parsed.password ||
            parsed.port ||
            parsed.pathname !== "/" ||
            parsed.search ||
            parsed.hash
        ) {
            throw new Error("domain_invalid");
        }
        ascii = parsed.hostname.toLowerCase().replace(/\.$/, "");
    } catch {
        throw new Error("domain_invalid");
    }
    if (
        ascii.length > 253 ||
        ascii.split(".").length < 2 ||
        ascii
            .split(".")
            .some(
                (label) =>
                    !label ||
                    label.length > 63 ||
                    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
            )
    ) {
        throw new Error("domain_invalid");
    }
    // A registrable domain must have a suffix; this conservative guard keeps
    // obvious public-suffix inputs out without introducing a mutable PSL at
    // runtime. Subdomains (e.g. mail.example.com) remain valid.
    const suffix = ascii.split(".").at(-1)!;
    if (suffix.length < 2 || /^[0-9]+$/.test(suffix))
        throw new Error("domain_public_suffix");
    return ascii;
}

function hashChallenge(token: string): string {
    return createHmac("sha256", verificationKey())
        .update(token, "utf8")
        .digest("hex");
}

function resolveTxtWithTimeout(
    name: string,
    timeoutMs = 5_000,
): Promise<string[][]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("dns_timeout")),
            timeoutMs,
        );
        dns.resolveTxt(name).then(
            (records) => {
                clearTimeout(timer);
                resolve(records);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export function serializeSendingDomain(
    row: typeof sendingDomains.$inferSelect,
    challengeToken: string | null = null,
) {
    const challenge = challengeToken
        ? `_sendlit-verification.${row.domain}`
        : null;
    return {
        domainId: row.domainId,
        domain: row.domain,
        status: row.status as "pending" | "verified" | "revoked" | "failed",
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
        nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
        challengeToken,
        challengeRecordName: challenge,
        challengeRecordValue: challengeToken,
    };
}

export async function listSendingDomains(organizationId: string) {
    return db
        .select()
        .from(sendingDomains)
        .where(eq(sendingDomains.organizationId, organizationId));
}

export async function createSendingDomain(
    organizationId: string,
    input: string,
) {
    const domain = normalizeSendingDomain(input);
    const token = randomBytes(32).toString("base64url");
    const [row] = await db
        .insert(sendingDomains)
        .values({
            organizationId,
            domain,
            challengeTokenHash: hashChallenge(token),
            status: "pending",
        })
        .returning();
    return { row, token };
}

async function recordFailedVerification(
    row: typeof sendingDomains.$inferSelect,
    now: Date,
) {
    const failedCheckCount = row.failedCheckCount + 1;
    const firstFailedAt = row.firstFailedAt ?? now;
    const revoke =
        row.status === "verified" &&
        failedCheckCount >= 3 &&
        firstFailedAt.getTime() <= now.getTime() - 72 * 60 * 60 * 1000;
    const nextStatus = revoke
        ? "revoked"
        : row.status === "verified"
          ? "verified"
          : "failed";
    const updated = await db.transaction(async (tx) => {
        const [next] = await tx
            .update(sendingDomains)
            .set({
                status: nextStatus,
                lastCheckedAt: now,
                nextCheckAt: new Date(
                    now.getTime() + (revoke ? 30 : 1) * 24 * 60 * 60 * 1000,
                ),
                failedCheckCount,
                firstFailedAt,
                updatedAt: now,
            })
            .where(eq(sendingDomains.id, row.id))
            .returning();
        if (next && (failedCheckCount === 1 || revoke)) {
            await tx.insert(organizationAuditEvents).values({
                organizationId: row.organizationId,
                actorType: "system",
                action: revoke
                    ? "sending_domain.revoked_after_failed_checks"
                    : "sending_domain.verification_check_failed",
                metadata: {
                    domain: row.domain,
                    failedCheckCount,
                    firstFailedAt: firstFailedAt.toISOString(),
                },
            });
        }
        return next;
    });
    return {
        row: updated ?? {
            ...row,
            status: nextStatus,
            lastCheckedAt: now,
            nextCheckAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            failedCheckCount,
            firstFailedAt,
        },
        verified: false,
    };
}

export async function verifySendingDomain(
    organizationId: string,
    domainId: string,
) {
    const [row] = await db
        .select()
        .from(sendingDomains)
        .where(
            and(
                eq(sendingDomains.organizationId, organizationId),
                eq(sendingDomains.domainId, domainId),
            ),
        )
        .limit(1);
    if (!row) return null;
    if (row.status === "revoked") return { row, verified: false };
    let records: string[][];
    try {
        // Node's resolver has no per-request timeout. Bound the lookup so a
        // nameserver or network failure cannot pin an API worker indefinitely.
        records = await resolveTxtWithTimeout(
            `_sendlit-verification.${row.domain}`,
        );
    } catch {
        return recordFailedVerification(row, new Date());
    }
    const verified = records
        .map((chunks) => chunks.join(""))
        .some((value) => {
            const actual = Buffer.from(hashChallenge(value), "hex");
            const expected = Buffer.from(row.challengeTokenHash, "hex");
            return (
                actual.length === expected.length &&
                timingSafeEqual(actual, expected)
            );
        });
    const now = new Date();
    if (!verified) return recordFailedVerification(row, now);
    const [updated] = await db
        .update(sendingDomains)
        .set({
            status: "verified",
            verifiedAt: row.verifiedAt ?? now,
            lastCheckedAt: now,
            nextCheckAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            failedCheckCount: 0,
            firstFailedAt: null,
            updatedAt: now,
        })
        .where(eq(sendingDomains.id, row.id))
        .returning();
    return { row: updated ?? row, verified };
}

export async function revokeSendingDomain(
    organizationId: string,
    domainId: string,
): Promise<boolean> {
    const [updated] = await db
        .update(sendingDomains)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(
            and(
                eq(sendingDomains.organizationId, organizationId),
                eq(sendingDomains.domainId, domainId),
            ),
        )
        .returning({ id: sendingDomains.id });
    return Boolean(updated);
}

/**
 * Cloud test volume is intentionally small, but once crossed we require an
 * exact verified From domain. This check is performed at the delivery-source
 * boundary so REST, MCP, workers, and future send paths share one policy.
 */
export async function assertSendingEligibility(
    organizationId: string,
    fromEmail: string,
    teamId?: string,
    espConfigId?: string,
): Promise<void> {
    if (process.env.SENDLIT_DEPLOYMENT_MODE !== "cloud") return;
    const [owner] = await db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .innerJoin(user, eq(user.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.role, "owner"),
                eq(user.emailVerified, true),
            ),
        )
        .limit(1);
    if (!owner)
        throw new PlanGateError("sending_paused", {
            organizationId,
            reason: "verified_owner_email_required",
        });

    const thresholdRaw = process.env.BILLING_TEST_VOLUME_THRESHOLD;
    const threshold =
        thresholdRaw === undefined || thresholdRaw === ""
            ? 100
            : Number(thresholdRaw);
    if (!Number.isSafeInteger(threshold) || threshold <= 0)
        throw new Error("BILLING_TEST_VOLUME_THRESHOLD_invalid");
    const [usage] = await db
        .select({ value: count() })
        .from(outboundMessages)
        .innerJoin(teams, eq(teams.id, outboundMessages.teamId))
        .where(
            and(
                eq(teams.organizationId, organizationId),
                gte(outboundMessages.acceptedAt, new Date(0)),
            ),
        );
    if (Number(usage?.value ?? 0) < threshold) return;

    if (teamId && espConfigId) {
        const [feedback] = await db
            .select({ id: espFeedbackConnections.id })
            .from(espFeedbackConnections)
            .where(
                and(
                    eq(espFeedbackConnections.teamId, teamId),
                    eq(espFeedbackConnections.espConfigId, espConfigId),
                    eq(espFeedbackConnections.status, "healthy"),
                ),
            )
            .limit(1);
        if (!feedback)
            throw new PlanGateError("sending_paused", {
                organizationId,
                reason: "feedback_connection_required",
            });
    }

    const at = fromEmail.lastIndexOf("@");
    let domain: string;
    try {
        domain = normalizeSendingDomain(fromEmail.slice(at + 1));
    } catch {
        throw new PlanGateError("domain_verification_required", {
            organizationId,
        });
    }
    const [verified] = await db
        .select({ id: sendingDomains.id })
        .from(sendingDomains)
        .where(
            and(
                eq(sendingDomains.organizationId, organizationId),
                eq(sendingDomains.domain, domain),
                eq(sendingDomains.status, "verified"),
            ),
        )
        .limit(1);
    if (!verified)
        throw new PlanGateError("domain_verification_required", {
            organizationId,
            domain,
        });
}
