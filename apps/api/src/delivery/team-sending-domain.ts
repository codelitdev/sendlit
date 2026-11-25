import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { normalizeSendingDomain } from "../billing/domains";
import { PlanGateError } from "../billing/errors";
import { db } from "../db/client";
import {
  espConfigs,
  espConfigTeamGrants,
  organizationDeliveryPolicies,
  organizationEspUsageBuckets,
  sendingDomains,
} from "../db/schema";
import { captureError, captureEvent } from "../observability";
import { recordOrganizationAuditEvent } from "../organization/audit";
import logger from "../services/log";
import { findDmarc } from "../settings/esp/domain-auth";
import { freshDnsLookups } from "../utils/dns";
import {
  type DomainDnsRecord,
  domainProviderFor,
  encryptManagementCredentials,
  type SesManagementCredentials,
} from "./domain-providers";

/**
 * A team's own From domain on its organization's shared ESP (#220). The
 * domain is registered with the ESP's API, the team publishes the DKIM
 * records it returns, and once the provider verifies it and DMARC is
 * published the team's mail goes out signed `d=` its own domain, so its
 * mailbox-provider reputation is its own.
 */

const HOUR = 60 * 60 * 1000;
const PENDING_RECHECK_MS = HOUR;
const VERIFIED_RECHECK_MS = 24 * HOUR;

/** How long a team keeps sending from its domain after DKIM or DMARC start
 * failing, before its marketing pauses. */
export function teamDomainGraceMs(): number {
  const raw = Number(process.env.TEAM_SENDING_DOMAIN_GRACE_HOURS ?? 72);
  return (Number.isFinite(raw) && raw >= 0 ? raw : 72) * HOUR;
}

type Actor = {
  type: "user" | "organization_key" | "system";
  id?: string | null;
};

type DomainRow = typeof sendingDomains.$inferSelect;

export type TeamSendingDomainView = {
  domain: string;
  fromEmail: string | null;
  /** `pending` until DKIM and DMARC first pass; `verified` once they have;
   * `failing` when they stopped passing after that. */
  status: "pending" | "verified" | "failing";
  dkim: "pending" | "verified" | "failed";
  dmarc: "pass" | "missing";
  /** Whether mail goes out from this domain right now. */
  inUse: boolean;
  records: (DomainDnsRecord & { present?: boolean })[];
  verifiedAt: string | null;
  failingSince: string | null;
  /** When marketing pauses if it keeps failing. */
  graceEndsAt: string | null;
  lastCheckedAt: string | null;
};

const DMARC_RECOMMENDED = "v=DMARC1; p=none;";

function dmarcRecord(domain: string): DomainDnsRecord {
  return {
    type: "TXT",
    name: `_dmarc.${domain}`,
    value: DMARC_RECOMMENDED,
    purpose: "dmarc",
  };
}

export function teamDomainStatus(row: DomainRow): TeamSendingDomainView["status"] {
  if (!row.authenticatedAt) return "pending";
  return row.authFailingSince ? "failing" : "verified";
}

function viewOf(row: DomainRow, fromEmail: string | null): TeamSendingDomainView {
  const failingSince = row.authFailingSince;
  const status = !row.authenticatedAt
    ? "pending"
    : failingSince
      ? "failing"
      : "verified";
  const dmarc = (row.dmarcStatus as "pass" | "missing" | null) ?? "missing";
  const records = ((row.dnsRecords as DomainDnsRecord[] | null) ?? []).map((record) =>
    record.purpose === "dmarc"
      ? { ...record, present: dmarc === "pass" }
      : { ...record, present: row.dkimStatus === "verified" },
  );
  return {
    domain: row.domain,
    fromEmail,
    status,
    dkim: (row.dkimStatus as TeamSendingDomainView["dkim"] | null) ?? "pending",
    dmarc,
    inUse: teamDomainUsable(row, new Date()),
    records,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    failingSince: failingSince?.toISOString() ?? null,
    graceEndsAt: failingSince
      ? new Date(failingSince.getTime() + teamDomainGraceMs()).toISOString()
      : null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

/** The domain authenticated at least once and, if it has since started
 * failing, is still within its grace period. */
export function teamDomainUsable(row: DomainRow, now: Date): boolean {
  if (row.status !== "verified" || !row.authenticatedAt) return false;
  if (!row.authFailingSince) return true;
  return now.getTime() - row.authFailingSince.getTime() < teamDomainGraceMs();
}

async function liveGrant(teamId: string) {
  const [row] = await db
    .select({ grant: espConfigTeamGrants, esp: espConfigs })
    .from(espConfigTeamGrants)
    .innerJoin(espConfigs, eq(espConfigs.id, espConfigTeamGrants.espConfigId))
    .where(
      and(
        eq(espConfigTeamGrants.teamId, teamId),
        ne(espConfigTeamGrants.status, "revoked"),
        eq(espConfigs.ownerScope, "organization"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function liveDomain(teamId: string): Promise<DomainRow | null> {
  const [row] = await db
    .select()
    .from(sendingDomains)
    .where(and(eq(sendingDomains.teamId, teamId), ne(sendingDomains.status, "revoked")))
    .limit(1);
  return row ?? null;
}

export async function getTeamSendingDomain(
  teamId: string,
): Promise<TeamSendingDomainView | null> {
  const [domain, grant] = await Promise.all([liveDomain(teamId), liveGrant(teamId)]);
  if (!domain) return null;
  return viewOf(
    domain,
    grant?.grant.sendingDomainId === domain.id ? grant.grant.fromEmail : null,
  );
}

/**
 * Sets the team's From address on its shared ESP and registers the
 * address's domain with the ESP. Replacing a different domain removes the
 * old one from the ESP. Throws `organization_delivery_disabled` without a
 * grant, `from_email_invalid`, `domain_invalid`, `domain_in_use`,
 * `provider_domain_unsupported` or `esp_management_credentials_required`.
 */
export async function setTeamSendingDomain(
  organizationId: string,
  teamId: string,
  input: { fromEmail: string },
  actor: Actor,
): Promise<TeamSendingDomainView> {
  const fromEmail = input.fromEmail.trim().toLowerCase();
  const at = fromEmail.lastIndexOf("@");
  if (at < 1 || at === fromEmail.length - 1) throw new Error("from_email_invalid");
  const domain = normalizeSendingDomain(fromEmail.slice(at + 1));
  const grant = await liveGrant(teamId);
  if (!grant || grant.grant.organizationId !== organizationId) {
    throw new Error("organization_delivery_disabled");
  }
  const adapter = domainProviderFor(grant.esp);

  const [taken] = await db
    .select({ teamId: sendingDomains.teamId })
    .from(sendingDomains)
    .where(
      and(
        eq(sendingDomains.organizationId, organizationId),
        eq(sendingDomains.domain, domain),
        ne(sendingDomains.status, "revoked"),
      ),
    )
    .limit(1);
  if (taken && taken.teamId !== teamId) throw new Error("domain_in_use");

  const existing = await liveDomain(teamId);
  if (existing && existing.domain !== domain) {
    await removeFromProvider(existing);
  }
  const state = await adapter.register(domain);
  const now = new Date();
  const records = [...state.records, dmarcRecord(domain)];

  const row = await db.transaction(async (tx) => {
    let saved: DomainRow;
    if (existing && existing.domain === domain) {
      [saved] = await tx
        .update(sendingDomains)
        .set({ dnsRecords: records, nextCheckAt: now, updatedAt: now })
        .where(eq(sendingDomains.id, existing.id))
        .returning();
    } else {
      if (existing) {
        await tx
          .update(sendingDomains)
          .set({ status: "revoked", updatedAt: now })
          .where(eq(sendingDomains.id, existing.id));
      }
      // A revoked row for the same domain would collide on the
      // organization/domain unique index; reuse it.
      const [revoked] = await tx
        .select({ id: sendingDomains.id })
        .from(sendingDomains)
        .where(
          and(
            eq(sendingDomains.organizationId, organizationId),
            eq(sendingDomains.domain, domain),
          ),
        )
        .limit(1);
      const values = {
        teamId,
        espConfigId: grant.esp.id,
        provider: adapter.provider,
        status: "pending",
        dkimStatus: state.dkim,
        dmarcStatus: "missing",
        dnsRecords: records,
        verifiedAt: null,
        authenticatedAt: null,
        authFailingSince: null,
        failedCheckCount: 0,
        firstFailedAt: null,
        nextCheckAt: now,
        updatedAt: now,
      };
      if (revoked) {
        [saved] = await tx
          .update(sendingDomains)
          .set(values)
          .where(eq(sendingDomains.id, revoked.id))
          .returning();
      } else {
        [saved] = await tx
          .insert(sendingDomains)
          .values({
            ...values,
            organizationId,
            domain,
            // Ownership is proven by the provider's DKIM check, not the
            // organization TXT challenge; keep the column's contract.
            challengeTokenHash: createHash("sha256")
              .update(randomBytes(32))
              .digest("hex"),
          })
          .returning();
      }
    }
    await tx
      .update(espConfigTeamGrants)
      .set({ fromEmail, sendingDomainId: saved.id, updatedAt: now })
      .where(eq(espConfigTeamGrants.id, grant.grant.id));
    await recordOrganizationAuditEvent(tx, {
      organizationId,
      actor,
      action: "team_sending_domain.set",
      teamId,
      espConfigId: grant.esp.id,
      espGrantId: grant.grant.id,
      metadata: { domain },
    });
    return saved;
  });
  captureEvent({
    event: "team_sending_domain_set",
    source: "delivery.team_sending_domain",
    teamId,
    properties: { provider: adapter.provider },
  });
  return viewOf(await checkTeamSendingDomain(row), fromEmail);
}

async function removeFromProvider(row: DomainRow): Promise<void> {
  if (!row.espConfigId) return;
  const [esp] = await db
    .select()
    .from(espConfigs)
    .where(eq(espConfigs.id, row.espConfigId))
    .limit(1);
  if (!esp) return;
  try {
    await domainProviderFor(esp).remove(row.domain);
  } catch (error) {
    // The team's choice still applies in SendLit; a leftover identity at
    // the provider is harmless and is logged for the operator.
    logger.warn(
      { sending_domain: row.domainId, error: (error as Error).message },
      "team sending domain: provider removal failed",
    );
  }
}

/** Stops using the team's own domain and removes it from the ESP. The team
 * goes back to the shared domain, which the organization's policy may
 * refuse. */
export async function removeTeamSendingDomain(
  organizationId: string,
  teamId: string,
  actor: Actor,
): Promise<boolean> {
  const row = await liveDomain(teamId);
  if (!row || row.organizationId !== organizationId) return false;
  await removeFromProvider(row);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(sendingDomains)
      .set({ status: "revoked", nextCheckAt: null, updatedAt: now })
      .where(eq(sendingDomains.id, row.id));
    await tx
      .update(espConfigTeamGrants)
      .set({ fromEmail: null, sendingDomainId: null, updatedAt: now })
      .where(eq(espConfigTeamGrants.sendingDomainId, row.id));
    await recordOrganizationAuditEvent(tx, {
      organizationId,
      actor,
      action: "team_sending_domain.removed",
      teamId,
      espConfigId: row.espConfigId,
      metadata: { domain: row.domain },
    });
  });
  return true;
}

/**
 * Re-checks a team domain with the provider and DNS and records the result:
 * DKIM verified by the provider and a DMARC record published means it
 * authenticates. A domain that authenticated before and now fails starts
 * its grace period instead of switching back to the shared domain.
 */
export async function checkTeamSendingDomain(
  row: DomainRow,
  now = new Date(),
): Promise<DomainRow> {
  if (!row.espConfigId) return row;
  const [esp] = await db
    .select()
    .from(espConfigs)
    .where(eq(espConfigs.id, row.espConfigId))
    .limit(1);
  if (!esp) return row;
  const [state, dmarc] = await Promise.all([
    domainProviderFor(esp).status(row.domain),
    findDmarc(freshDnsLookups().resolveTxt, row.domain),
  ]);
  const dkim = state?.dkim ?? "failed";
  const passing = Boolean(state?.verified && dkim === "verified" && dmarc);
  const authenticatedBefore = Boolean(row.authenticatedAt);
  const failingSince = passing
    ? null
    : authenticatedBefore
      ? (row.authFailingSince ?? now)
      : null;
  const records = state
    ? [...state.records, dmarcRecord(row.domain)]
    : ((row.dnsRecords as DomainDnsRecord[] | null) ?? []);
  const [saved] = await db
    .update(sendingDomains)
    .set({
      status: passing || authenticatedBefore ? "verified" : "pending",
      dkimStatus: dkim,
      dmarcStatus: dmarc ? "pass" : "missing",
      dnsRecords: records,
      verifiedAt: passing ? (row.verifiedAt ?? now) : row.verifiedAt,
      authenticatedAt: passing ? now : row.authenticatedAt,
      authFailingSince: failingSince,
      lastCheckedAt: now,
      nextCheckAt: new Date(
        now.getTime() + (passing ? VERIFIED_RECHECK_MS : PENDING_RECHECK_MS),
      ),
      updatedAt: now,
    })
    .where(eq(sendingDomains.id, row.id))
    .returning();
  const changed =
    (passing && !authenticatedBefore) ||
    (passing && row.authFailingSince) ||
    (!passing && authenticatedBefore && !row.authFailingSince);
  if (changed) {
    const action = !passing
      ? "team_sending_domain.failing"
      : authenticatedBefore
        ? "team_sending_domain.recovered"
        : "team_sending_domain.verified";
    await recordOrganizationAuditEvent(db, {
      organizationId: row.organizationId,
      actor: { type: "system" },
      action,
      teamId: row.teamId,
      espConfigId: row.espConfigId,
      metadata: { domain: row.domain, dkim, dmarc: Boolean(dmarc) },
    });
    captureEvent({
      event: action.replace(".", "_"),
      source: "delivery.team_sending_domain",
      teamId: row.teamId ?? undefined,
    });
  }
  return saved ?? row;
}

/** Re-checks the team domain now, for a dashboard or API "check" request. */
export async function refreshTeamSendingDomain(
  teamId: string,
): Promise<TeamSendingDomainView | null> {
  const row = await liveDomain(teamId);
  if (!row) return null;
  const grant = await liveGrant(teamId);
  const checked = await checkTeamSendingDomain(row);
  return viewOf(checked, grant?.grant.fromEmail ?? null);
}

/** The hourly sweep over team domains that are due. */
export async function checkDueTeamSendingDomains(now = new Date()): Promise<void> {
  const due = await db
    .select()
    .from(sendingDomains)
    .where(
      and(
        isNotNull(sendingDomains.teamId),
        inArray(sendingDomains.status, ["pending", "verified"]),
        lt(sendingDomains.nextCheckAt, now),
      ),
    )
    .limit(100);
  for (const row of due) {
    try {
      await checkTeamSendingDomain(row, now);
    } catch (error) {
      captureError({
        error,
        source: "delivery.team_sending_domain.check",
        teamId: row.teamId ?? undefined,
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startTeamSendingDomainChecks(intervalMs = HOUR): void {
  if (timer) return;
  timer = setInterval(() => {
    void checkDueTeamSendingDomains().catch((error) =>
      captureError({ error, source: "delivery.team_sending_domain.sweep" }),
    );
  }, intervalMs);
  timer.unref?.();
}

export function stopTeamSendingDomainChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

type GrantForSend = {
  id: string;
  organizationId: string;
  fromEmail: string | null;
  sendingDomainId: string | null;
};

/**
 * The From address a team sends from through a shared ESP, applying the
 * organization's policy. Never falls back to the shared domain once the
 * team's own domain has authenticated: past the grace period its marketing
 * pauses instead.
 */
export async function teamFromAddress(
  grant: GrantForSend,
  sharedFromEmail: string,
  purpose: "marketing" | "transactional",
  now = new Date(),
): Promise<string> {
  if (grant.sendingDomainId && grant.fromEmail) {
    const [row] = await db
      .select()
      .from(sendingDomains)
      .where(eq(sendingDomains.id, grant.sendingDomainId))
      .limit(1);
    if (row?.authenticatedAt && row.status === "verified") {
      if (teamDomainUsable(row, now) || purpose === "transactional") {
        return grant.fromEmail;
      }
      throw new PlanGateError("sending_paused", {
        organizationId: grant.organizationId,
        reason: "team_sending_domain_failing",
        scope: "team",
        domain: row.domain,
      });
    }
  }
  const [policy] = await db
    .select({
      require: organizationDeliveryPolicies.requireTeamSendingDomain,
      sharedLimit: organizationDeliveryPolicies.sharedDomainMonthlyLimit,
    })
    .from(organizationDeliveryPolicies)
    .where(eq(organizationDeliveryPolicies.organizationId, grant.organizationId))
    .limit(1);
  if (
    policy?.require === "all" ||
    (policy?.require === "marketing" && purpose === "marketing")
  ) {
    throw new PlanGateError("domain_verification_required", {
      organizationId: grant.organizationId,
      reason: "team_sending_domain_required",
    });
  }
  if (purpose === "marketing" && policy?.sharedLimit != null) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [bucket] = await db
      .select({ accepted: organizationEspUsageBuckets.acceptedCount })
      .from(organizationEspUsageBuckets)
      .where(
        and(
          eq(organizationEspUsageBuckets.grantId, grant.id),
          eq(organizationEspUsageBuckets.periodType, "month"),
          eq(organizationEspUsageBuckets.periodStart, month),
        ),
      )
      .limit(1);
    if ((bucket?.accepted ?? 0) >= policy.sharedLimit) {
      throw new PlanGateError("plan_limit_reached", {
        organizationId: grant.organizationId,
        capability: "shared_domain_monthly_limit",
        limit: policy.sharedLimit,
      });
    }
  }
  return sharedFromEmail;
}

/**
 * Stores the shared ESP's provider API credential (SES only for now), after
 * checking it works with a lookup that needs `ses:GetEmailIdentity`.
 * Throws `esp_not_found`, `provider_domain_unsupported` or
 * `esp_management_credentials_invalid`.
 */
export async function setEspManagementCredentials(
  organizationId: string,
  espPublicId: string,
  credentials: SesManagementCredentials,
  actor: Actor,
): Promise<typeof espConfigs.$inferSelect> {
  const esp = await organizationEsp(organizationId, espPublicId);
  if (esp.provider !== "ses") throw new Error("provider_domain_unsupported");
  const encrypted = encryptManagementCredentials(credentials);
  try {
    // A reserved name no one owns: valid credentials answer "not found".
    await domainProviderFor({ ...esp, encryptedManagementSecret: encrypted }).status(
      "credential-check.sendlit.invalid",
    );
  } catch {
    throw new Error("esp_management_credentials_invalid");
  }
  const [saved] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(espConfigs)
      .set({ encryptedManagementSecret: encrypted, updatedAt: new Date() })
      .where(eq(espConfigs.id, esp.id))
      .returning();
    await recordOrganizationAuditEvent(tx, {
      organizationId,
      actor,
      action: "organization_esp.management_credentials_set",
      espConfigId: esp.id,
    });
    return rows;
  });
  return saved;
}

export async function removeEspManagementCredentials(
  organizationId: string,
  espPublicId: string,
  actor: Actor,
): Promise<typeof espConfigs.$inferSelect> {
  const esp = await organizationEsp(organizationId, espPublicId);
  const [saved] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(espConfigs)
      .set({ encryptedManagementSecret: null, updatedAt: new Date() })
      .where(eq(espConfigs.id, esp.id))
      .returning();
    await recordOrganizationAuditEvent(tx, {
      organizationId,
      actor,
      action: "organization_esp.management_credentials_removed",
      espConfigId: esp.id,
    });
    return rows;
  });
  return saved;
}

async function organizationEsp(organizationId: string, espPublicId: string) {
  const [esp] = await db
    .select()
    .from(espConfigs)
    .where(
      and(
        eq(espConfigs.organizationId, organizationId),
        eq(espConfigs.ownerScope, "organization"),
        eq(espConfigs.espId, espPublicId),
      ),
    )
    .limit(1);
  if (!esp) throw new Error("esp_not_found");
  return esp;
}

/** HTTP status and body for a team sending domain error, or null. */
export function teamDomainErrorHttp(
  error: unknown,
): { status: 400 | 404 | 409 | 422 | 502; body: { error: string } } | null {
  const message = (error as Error | undefined)?.message;
  switch (message) {
    case "from_email_invalid":
    case "domain_invalid":
    case "domain_public_suffix":
      return { status: 400, body: { error: message } };
    case "esp_not_found":
      return { status: 404, body: { error: message } };
    case "domain_in_use":
      return { status: 409, body: { error: message } };
    case "organization_delivery_disabled":
    case "provider_domain_unsupported":
    case "esp_management_credentials_required":
    case "esp_management_credentials_invalid":
      return { status: 422, body: { error: message } };
    default:
      // The provider's API refused or failed (permissions, throttling).
      if ((error as { $metadata?: unknown } | undefined)?.$metadata) {
        return { status: 502, body: { error: "esp_provider_error" } };
      }
      return null;
  }
}
