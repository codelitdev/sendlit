import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";

const authState = { userId: "", authKind: "session" as string };
const WEB = "http://localhost:3000";
process.env.WEB_CLIENT = WEB;

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = authState.userId;
    req.authKind = authState.authKind;
    next();
  },
}));
const sendVerificationOTP = vi.fn(async () => ({ success: true }));
const checkVerificationOTP = vi.fn(async ({ body }: any) => {
  if (body.otp !== "123456") throw new Error("INVALID_OTP");
  return { success: true };
});
const realAuth = await import("../auth/better-auth");
mock.module("../auth/better-auth", () => ({
  ...realAuth,
  auth: { ...realAuth.auth, api: { sendVerificationOTP, checkVerificationOTP } },
}));
mock.module("../media/service", () => ({ deleteMedia: vi.fn() }));
mock.module("../media/deletion-queue", () => ({ queueMediaLitDeletion: vi.fn() }));
const captureEvent = vi.fn();
const realObservability = await import("../observability");
mock.module("../observability", () => ({ ...realObservability, captureEvent }));

const { db } = await import("../db/client");
const schema = await import("../db/schema");
const { createUploadedMedia } = await import("../media/queries");
const { deleteMedia } = await import("../media/service");
const { createTeam } = await import("../team/queries");
const { truncateAll } = await import("../test/db");
const {
  activateFakeCatalog,
  clearCloudFakeBillingEnv,
  seedPaidSubscription,
  useCloudFakeBillingEnv,
} = await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const { requestApp } = await import("../test/http");
const { addOrganizationMemberByEmail, createOrganization, ensureDefaultOrganization } =
  await import("../organization/queries");
const { resolveAuth } = await import("../auth/resolve-auth");
const { default: accountRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;
const deleteMediaMock = deleteMedia as unknown as ReturnType<typeof vi.fn>;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(accountRoutes);
  return instance;
}

const sessionHeaders = {
  origin: WEB,
  cookie: "sendlit_csrf=csrf-token",
  "x-sendlit-csrf": "csrf-token",
  "content-type": "application/json",
};

function deleteRequest(body: { email: string; code: string }) {
  return requestApp(app(), "/account/deletion", {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify(body),
  });
}

async function insertUser(name: string) {
  const id = crypto.randomUUID();
  const [row] = await tdb
    .insert(schema.user)
    .values({
      id,
      name,
      email: `${name.toLowerCase()}-${id}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const now = new Date();
  await tdb.insert(schema.session).values({
    id: `session-${id}`,
    token: `token-${id}`,
    userId: id,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  });
  await tdb.insert(schema.account).values({
    id: `account-${id}`,
    accountId: id,
    providerId: "credential",
    userId: id,
    createdAt: now,
    updatedAt: now,
  });
  await tdb.insert(schema.verification).values({
    id: `verification-${id}`,
    identifier: `sign-in-otp-${row.email}`,
    value: "hashed:0",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return row;
}

/** An organization with a team holding contacts, mail history, media and a
 * suppression, so erasure can be checked against all of them. */
async function seedOrganization(owner: { id: string }, name: string) {
  const organization = await createOrganization(owner.id, name);
  const team = await createTeam({
    organizationId: organization.id,
    creatorUserId: owner.id,
    name: `${name} team`,
  });
  const recipient = `reader-${name}@example.com`;
  await tdb.insert(schema.contacts).values([
    {
      teamId: team.id,
      email: recipient,
      name: "Reader",
      unsubscribeToken: `unsub-${name}-1`,
    },
    {
      teamId: team.id,
      email: `second-${name}@example.com`,
      unsubscribeToken: `unsub-${name}-2`,
    },
  ]);
  const mediaLitIds = [`${name}-a`, `${name}-b`];
  for (const mediaLitId of mediaLitIds) {
    await createUploadedMedia({
      teamId: team.id,
      mediaLitId,
      url: `https://cdn.test/${mediaLitId}.png`,
    });
  }
  const [esp] = await tdb
    .insert(schema.espConfigs)
    .values({
      ownerScope: "team",
      teamId: team.id,
      name: "Team",
      host: "smtp.example.com",
      encryptedSecret: "secret",
      status: "draft",
    })
    .returning();
  await tdb.insert(schema.outboundMessages).values({
    teamId: team.id,
    deliverySourceType: "team",
    espConfigId: esp.id,
    sourceType: "campaign",
    recipientEmail: recipient,
    normalizedRecipient: recipient,
  });
  await tdb.insert(schema.transactionalEmails).values({
    teamId: team.id,
    deliverySourceType: "team",
    outboxId: esp.id,
    toEmail: recipient,
    subject: "Receipt",
    html: "<p>Hi Reader</p>",
    variables: { name: "Reader" },
  });
  await tdb.insert(schema.emailSuppressions).values({
    teamId: team.id,
    recipientEmail: recipient,
    normalizedRecipient: recipient,
    recipientHash: `hash-${name}`,
    hashKeyVersion: 1,
    reason: "hard_bounce",
  });
  const [form] = await tdb
    .insert(schema.signupForms)
    .values({ teamId: team.id, name: "Newsletter" })
    .returning();
  await tdb.insert(schema.signupConfirmations).values({
    token: `confirm-${name}`,
    formId: form.id,
    email: recipient,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { organization, team, mediaLitIds, recipient };
}

async function organizationStatus(id: string) {
  const [row] = await tdb
    .select({ status: schema.organizations.status })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, id));
  return row?.status;
}

async function userRow(id: string) {
  const [row] = await tdb.select().from(schema.user).where(eq(schema.user.id, id));
  return row;
}

beforeEach(async () => {
  process.env.WEB_CLIENT = WEB;
  await truncateAll(tdb);
  deleteMediaMock.mockReset();
  captureEvent.mockReset();
  sendVerificationOTP.mockClear();
  checkVerificationOTP.mockClear();
  authState.userId = "";
  authState.authKind = "session";
});

afterEach(() => {
  clearCloudFakeBillingEnv();
});

describe("GET /account/deletion", () => {
  it("lists what happens to each organization", async () => {
    const owner = await insertUser("Owner");
    const partner = await insertUser("Partner");
    const solo = await seedOrganization(owner, "solo");
    const shared = await seedOrganization(partner, "shared");
    await addOrganizationMemberByEmail(shared.organization.id, owner.email, "owner");
    const crowded = await seedOrganization(owner, "crowded");
    await addOrganizationMemberByEmail(crowded.organization.id, partner.email, "admin");
    authState.userId = owner.id;

    const response = await requestApp(app(), "/account/deletion");

    expect(response.status).toBe(200);
    const body = response.json();
    expect(body.email).toBe(owner.email);
    expect(body.blocked).toBe(true);
    const byId = Object.fromEntries(
      body.organizations.map((item: any) => [item.organizationId, item]),
    );
    expect(byId[solo.organization.organizationId]).toMatchObject({
      action: "delete",
      blocker: null,
      teamCount: 1,
    });
    expect(byId[shared.organization.organizationId]).toMatchObject({
      action: "leave",
      blocker: null,
    });
    expect(byId[crowded.organization.organizationId]).toMatchObject({
      action: "delete",
      blocker: "last_organization_owner",
    });
  });

  it("is for dashboard sessions only", async () => {
    const owner = await insertUser("Owner");
    authState.userId = owner.id;
    authState.authKind = "oauth";

    const response = await requestApp(app(), "/account/deletion");

    expect(response.status).toBe(403);
    expect(response.json<{ error: string }>()).toEqual({
      error: "human_session_required",
    });
  });
});

describe("POST /account/deletion/code", () => {
  it("emails a confirmation code to the account", async () => {
    const owner = await insertUser("Owner");
    authState.userId = owner.id;

    const response = await requestApp(app(), "/account/deletion/code", {
      method: "POST",
      headers: sessionHeaders,
    });

    expect(response.status).toBe(204);
    expect(sendVerificationOTP).toHaveBeenCalledWith({
      body: { email: owner.email, type: "email-verification" },
    });
  });

  it("needs the dashboard's CSRF token", async () => {
    const owner = await insertUser("Owner");
    authState.userId = owner.id;

    const response = await requestApp(app(), "/account/deletion/code", {
      method: "POST",
      headers: { origin: WEB },
    });

    expect(response.status).toBe(403);
    expect(sendVerificationOTP).not.toHaveBeenCalled();
  });
});

describe("POST /account/deletion", () => {
  it("deletes sole-owned organizations, leaves shared ones and erases the person", async () => {
    const owner = await insertUser("Owner");
    const partner = await insertUser("Partner");
    const solo = await seedOrganization(owner, "solo");
    const shared = await seedOrganization(partner, "shared");
    await addOrganizationMemberByEmail(shared.organization.id, owner.email, "owner");
    await tdb.insert(schema.teamMembers).values({
      teamId: shared.team.id,
      userId: owner.id,
      role: "member",
    });
    await tdb.insert(schema.abuseFlags).values({
      organizationId: solo.organization.id,
      userId: owner.id,
      kind: "signup",
      severity: "low",
      reason: "Signed up with a free email provider",
      details: { email: owner.email, ip: "203.0.113.9", riskScore: 40 },
    });
    authState.userId = owner.id;

    const response = await deleteRequest({ email: owner.email, code: "123456" });

    expect(response.status).toBe(204);
    expect(String(response.headers["set-cookie"])).toContain("sendlit.session_token=;");

    // The sole-owned organization is deleted with its MediaLit files...
    expect(await organizationStatus(solo.organization.id)).toBe("closed");
    expect(deleteMediaMock.mock.calls.map(([id]) => id).sort()).toEqual(
      solo.mediaLitIds,
    );
    const media = await tdb.select().from(schema.media);
    expect(media.map((row) => row.mediaLitId).sort()).toEqual(shared.mediaLitIds);

    // ...and its contacts' personal data erased; suppression hashes stay.
    const soloContacts = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.teamId, solo.team.id));
    expect(soloContacts).toHaveLength(0);
    const [suppression] = await tdb
      .select()
      .from(schema.emailSuppressions)
      .where(eq(schema.emailSuppressions.teamId, solo.team.id));
    expect(suppression).toMatchObject({
      recipientEmail: null,
      normalizedRecipient: null,
      recipientHash: "hash-solo",
      active: true,
    });
    const [outbound] = await tdb
      .select()
      .from(schema.outboundMessages)
      .where(eq(schema.outboundMessages.teamId, solo.team.id));
    expect(outbound.recipientEmail).toBe("");
    const [transactional] = await tdb
      .select()
      .from(schema.transactionalEmails)
      .where(eq(schema.transactionalEmails.teamId, solo.team.id));
    expect(transactional).toMatchObject({ toEmail: "", html: null, variables: {} });
    const confirmations = await tdb.select().from(schema.signupConfirmations);
    expect(confirmations.map((row) => row.token)).toEqual(["confirm-shared"]);

    // The shared organization keeps everything; only the membership goes.
    expect(await organizationStatus(shared.organization.id)).toBe("active");
    const sharedContacts = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.teamId, shared.team.id));
    expect(sharedContacts).toHaveLength(2);
    const [sharedSuppression] = await tdb
      .select()
      .from(schema.emailSuppressions)
      .where(eq(schema.emailSuppressions.teamId, shared.team.id));
    expect(sharedSuppression.recipientEmail).toBe(shared.recipient);
    const memberships = await tdb
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, owner.id));
    expect(memberships).toHaveLength(0);
    const teamMemberships = await tdb
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, owner.id));
    expect(teamMemberships).toHaveLength(0);
    const audit = await tdb
      .select()
      .from(schema.organizationAuditEvents)
      .where(eq(schema.organizationAuditEvents.organizationId, shared.organization.id));
    expect(audit.map((event) => event.action)).toContain(
      "organization.member_account_deleted",
    );

    // The person is gone: identity erased, signed out everywhere.
    const erased = await userRow(owner.id);
    expect(erased.name).toBe("Deleted user");
    expect(erased.email).not.toContain("owner");
    expect(erased.deletedAt).toBeInstanceOf(Date);
    for (const table of [schema.session, schema.account]) {
      const rows = await tdb
        .select()
        .from(table)
        .where(inArray(table.userId, [owner.id, partner.id]));
      expect(rows.map((row) => row.userId)).toEqual([partner.id]);
    }
    const codes = await tdb.select().from(schema.verification);
    expect(codes.map((row) => row.identifier)).toEqual([
      `sign-in-otp-${partner.email}`,
    ]);
    const [flag] = await tdb.select().from(schema.abuseFlags);
    expect(flag.details).toEqual({ riskScore: 40 });

    // The other person is untouched.
    expect((await userRow(partner.id)).email).toBe(partner.email);

    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_deleted",
        properties: {
          user_id: owner.id,
          organizations_deleted_count: 1,
          organizations_left_count: 1,
          contacts_erased_count: 2,
          count: 2,
          media_failed_count: 0,
        },
      }),
    );
  });

  it("stops the deleted account's credentials from resolving", async () => {
    const owner = await insertUser("Owner");
    await seedOrganization(owner, "solo");
    authState.userId = owner.id;
    await deleteRequest({ email: owner.email, code: "123456" });

    const resolved = await resolveAuth(
      { headers: { cookie: "sendlit.session_token=whatever" } },
      {
        resolveSession: async () => ({
          status: "authenticated",
          identity: { method: "session", subject: owner.id },
        }),
      } as any,
    ).catch(() => ({ status: "unauthorized" }));
    expect(resolved.status).not.toBe("authenticated");
    expect(await ensureDefaultOrganization(owner.id)).toBeNull();
  });

  it("lets the same email sign up again as a new, empty account", async () => {
    const owner = await insertUser("Owner");
    await seedOrganization(owner, "solo");
    authState.userId = owner.id;
    await deleteRequest({ email: owner.email, code: "123456" });

    const [fresh] = await tdb
      .insert(schema.user)
      .values({
        id: crypto.randomUUID(),
        name: "Owner again",
        email: owner.email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const organization = await ensureDefaultOrganization(fresh.id);

    expect(organization).not.toBeNull();
    const teams = await tdb
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.organizationId, organization!.id));
    expect(teams).toHaveLength(1);
    const contacts = await tdb
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.teamId, teams[0].id));
    expect(contacts).toHaveLength(0);
  });

  it("is blocked while a sole-owned organization has a paid subscription", async () => {
    useCloudFakeBillingEnv();
    await activateFakeCatalog();
    const owner = await insertUser("Owner");
    const solo = await seedOrganization(owner, "solo");
    const paid = solo.organization;
    await seedPaidSubscription(tdb, { organizationId: paid.id, payerId: owner.id });
    authState.userId = owner.id;

    const response = await deleteRequest({ email: owner.email, code: "123456" });

    expect(response.status).toBe(409);
    const body = response.json();
    expect(body.error).toBe("account_deletion_blocked");
    expect(body.organizations).toContainEqual(
      expect.objectContaining({
        organizationId: paid.organizationId,
        blocker: "active_subscription_exists",
      }),
    );
    // Nothing changed.
    expect(await organizationStatus(paid.id)).toBe("active");
    expect(deleteMediaMock).not.toHaveBeenCalled();
    expect((await userRow(owner.id)).deletedAt).toBeNull();
  });

  it("is blocked while other members depend on them as the last owner", async () => {
    const owner = await insertUser("Owner");
    const admin = await insertUser("Admin");
    const solo = await seedOrganization(owner, "solo");
    await addOrganizationMemberByEmail(solo.organization.id, admin.email, "admin");
    authState.userId = owner.id;

    const response = await deleteRequest({ email: owner.email, code: "123456" });

    expect(response.status).toBe(409);
    expect(response.json().organizations[0].blocker).toBe("last_organization_owner");
    expect(await organizationStatus(solo.organization.id)).toBe("active");
  });

  it("needs the typed email and a valid code", async () => {
    const owner = await insertUser("Owner");
    const solo = await seedOrganization(owner, "solo");
    authState.userId = owner.id;

    const mismatch = await deleteRequest({
      email: "someone@example.com",
      code: "123456",
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json<{ error: string }>()).toEqual({ error: "email_mismatch" });

    const wrongCode = await deleteRequest({ email: owner.email, code: "000000" });
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.json<{ error: string }>()).toEqual({ error: "invalid_code" });

    expect(await organizationStatus(solo.organization.id)).toBe("active");
    expect((await userRow(owner.id)).deletedAt).toBeNull();
  });
});
