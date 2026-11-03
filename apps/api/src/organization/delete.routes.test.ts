import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";

const authState = { userId: "", authKind: "session" as string };

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db");
  return { db: await makeTestDb() };
});
mock.module("../auth/middleware", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = authState.userId;
    req.authKind = authState.authKind;
    req.organizationId = "";
    req.organizationApiKeyId = "";
    req.organizationScopes = [];
    next();
  },
}));
mock.module("../media/service", () => ({ deleteMedia: vi.fn() }));
const queueMediaLitDeletion = vi.fn();
mock.module("../media/deletion-queue", () => ({ queueMediaLitDeletion }));
const realSecurity = await import("../billing/security");
// The billing-action token is covered in billing/security.test.ts.
mock.module("../billing/security", () => ({
  ...realSecurity,
  requireBillingAction: async () => null,
}));
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
const { addOrganizationMemberByEmail, createOrganization, listOrganizationsForUser } =
  await import("./queries");
const { default: organizationRoutes } = await import("./routes");

const tdb = db as unknown as TestDb;
const deleteMediaMock = deleteMedia as unknown as ReturnType<typeof vi.fn>;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(organizationRoutes);
  return instance;
}

async function insertUser(name: string) {
  const [account] = await tdb
    .insert(schema.user)
    .values({
      id: crypto.randomUUID(),
      name,
      email: `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return account;
}

/** An organization with two teams, keys, a domain, ESPs, media and a
 * suppression, so a delete can be checked against all of them. */
async function seedOrganization(
  owner: { id: string },
  name: string,
  beforeTeams?: (organizationId: string) => Promise<unknown>,
) {
  const organization = await createOrganization(owner.id, name);
  await beforeTeams?.(organization.id);
  const teams = [];
  for (const teamName of ["One", "Two"]) {
    teams.push(
      await createTeam({
        organizationId: organization.id,
        creatorUserId: owner.id,
        name: `${name} ${teamName}`,
      }),
    );
  }
  const tag = crypto.randomUUID();
  await tdb.insert(schema.organizationApiKeys).values({
    organizationId: organization.id,
    name: "Integration",
    keyHash: `org-${tag}`,
    keyPrefix: "sl_org",
  });
  await tdb.insert(schema.teamApiKeys).values(
    teams.map((team, index) => ({
      teamId: team.id,
      name: "Key",
      keyHash: `team-${tag}-${index}`,
      keyPrefix: "sl_team",
    })),
  );
  await tdb.insert(schema.sendingDomains).values({
    organizationId: organization.id,
    domain: `${tag}.example.com`,
    challengeTokenHash: "hash",
    status: "verified",
  });
  await tdb.insert(schema.espConfigs).values([
    {
      ownerScope: "organization",
      organizationId: organization.id,
      name: "Shared",
      host: "smtp.example.com",
      encryptedSecret: "secret",
      status: "active",
    },
    {
      ownerScope: "team",
      teamId: teams[0].id,
      name: "Team",
      host: "smtp.example.com",
      encryptedSecret: "secret",
      status: "draft",
    },
  ]);
  const mediaLitIds: string[] = [];
  for (const team of teams) {
    for (const suffix of ["a", "b"]) {
      const mediaLitId = `${name}-${team.teamId}-${suffix}`;
      mediaLitIds.push(mediaLitId);
      await createUploadedMedia({
        teamId: team.id,
        mediaLitId,
        url: `https://cdn.test/${mediaLitId}.png`,
      });
    }
  }
  await tdb.insert(schema.emailSuppressions).values({
    teamId: teams[0].id,
    recipientHash: `hash-${tag}`,
    hashKeyVersion: 1,
    reason: "hard_bounce",
  });
  return { organization, teams, mediaLitIds };
}

function deletePath(organizationId: string) {
  return `/organizations/${organizationId}`;
}

async function organizationStatus(id: string) {
  const [row] = await tdb
    .select({ status: schema.organizations.status })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, id));
  return row?.status;
}

beforeEach(async () => {
  await truncateAll(tdb);
  deleteMediaMock.mockReset();
  queueMediaLitDeletion.mockReset();
  captureEvent.mockReset();
  authState.userId = "";
  authState.authKind = "session";
});

afterEach(() => {
  clearCloudFakeBillingEnv();
});

describe("DELETE /organizations/:organizationId", () => {
  it("deletes the organization and retires everything it owned", async () => {
    const owner = await insertUser("Owner");
    const { organization, teams, mediaLitIds } = await seedOrganization(owner, "acme");
    const other = await seedOrganization(owner, "other");
    authState.userId = owner.id;

    const response = await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await organizationStatus(organization.id)).toBe("closed");
    expect(await organizationStatus(other.organization.id)).toBe("active");
    const teamIds = teams.map((team) => team.id);
    const teamRows = await tdb
      .select({ status: schema.teams.status })
      .from(schema.teams)
      .where(inArray(schema.teams.id, teamIds));
    expect(teamRows.map((row) => row.status)).toEqual(["archived", "archived"]);

    const orgKeys = await tdb
      .select()
      .from(schema.organizationApiKeys)
      .where(eq(schema.organizationApiKeys.organizationId, organization.id));
    expect(orgKeys.every((key) => key.revokedAt)).toBe(true);
    const teamKeys = await tdb.select().from(schema.teamApiKeys);
    for (const key of teamKeys) {
      expect(Boolean(key.revokedAt)).toBe(teamIds.includes(key.teamId));
    }
    const domains = await tdb.select().from(schema.sendingDomains);
    for (const domain of domains) {
      expect(domain.status).toBe(
        domain.organizationId === organization.id ? "revoked" : "verified",
      );
    }
    const esps = await tdb.select().from(schema.espConfigs);
    for (const esp of esps) {
      const owned =
        esp.organizationId === organization.id || teamIds.includes(esp.teamId ?? "");
      if (owned) expect(esp.status).toBe("retired");
      else expect(["active", "draft"]).toContain(esp.status);
      expect(esp.encryptedSecret).toBe(owned ? null : "secret");
    }

    // Exactly this organization's MediaLit files, and their rows.
    expect(deleteMediaMock.mock.calls.map(([id]) => id).sort()).toEqual(
      [...mediaLitIds].sort(),
    );
    const remainingMedia = await tdb.select().from(schema.media);
    expect(remainingMedia.map((row) => row.mediaLitId).sort()).toEqual(
      [...other.mediaLitIds].sort(),
    );

    // Suppressions are compliance data and stay.
    expect(await tdb.select().from(schema.emailSuppressions)).toHaveLength(2);
    expect((await listOrganizationsForUser(owner.id)).map((item) => item.id)).toEqual([
      other.organization.id,
    ]);
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "organization_deleted",
        properties: expect.objectContaining({
          organization_id: organization.id,
          teams_count: 2,
          count: 4,
          media_failed_count: 0,
        }),
      }),
    );
  });

  it("hides a deleted organization from its members", async () => {
    const owner = await insertUser("Owner");
    const admin = await insertUser("Admin");
    const { organization } = await seedOrganization(owner, "acme");
    await addOrganizationMemberByEmail(organization.id, admin.email, "admin");
    authState.userId = owner.id;
    await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    for (const userId of [owner.id, admin.id]) {
      authState.userId = userId;
      for (const path of ["", "/teams", "/members"]) {
        const response = await requestApp(
          app(),
          `${deletePath(organization.organizationId)}${path}`,
        );
        expect(response.status).toBe(404);
      }
      const again = await requestApp(app(), deletePath(organization.organizationId), {
        method: "DELETE",
      });
      expect(again.status).toBe(404);
    }
  });

  it("still deletes when MediaLit fails, queueing the failed file for retry", async () => {
    const owner = await insertUser("Owner");
    const { organization, mediaLitIds } = await seedOrganization(owner, "acme");
    deleteMediaMock.mockImplementation(async (id: string) => {
      if (id === mediaLitIds[0]) throw new Error("medialit down");
    });
    authState.userId = owner.id;

    const response = await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await organizationStatus(organization.id)).toBe("closed");
    expect(await tdb.select().from(schema.media)).toHaveLength(0);
    expect(queueMediaLitDeletion.mock.calls.map(([job]) => job.mediaLitId)).toEqual([
      mediaLitIds[0],
    ]);
  });

  it("is owner only", async () => {
    const owner = await insertUser("Owner");
    const admin = await insertUser("Admin");
    const { organization } = await seedOrganization(owner, "acme");
    await addOrganizationMemberByEmail(organization.id, admin.email, "admin");
    authState.userId = admin.id;

    const response = await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(response.json<{ error: string }>()).toEqual({
      error: "organization_owner_required",
    });
    expect(await organizationStatus(organization.id)).toBe("active");
    expect(deleteMediaMock).not.toHaveBeenCalled();
  });

  it("hides the organization from people outside it", async () => {
    const owner = await insertUser("Owner");
    const stranger = await insertUser("Stranger");
    const { organization } = await seedOrganization(owner, "acme");
    authState.userId = stranger.id;

    const response = await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(await organizationStatus(organization.id)).toBe("active");
  });

  it("is blocked while a paid subscription is active", async () => {
    useCloudFakeBillingEnv();
    await activateFakeCatalog();
    const owner = await insertUser("Owner");
    const { organization } = await seedOrganization(owner, "acme", (organizationId) =>
      seedPaidSubscription(tdb, { organizationId, payerId: owner.id }),
    );
    authState.userId = owner.id;

    const response = await requestApp(app(), deletePath(organization.organizationId), {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(response.json<{ error: string }>()).toEqual({
      error: "active_subscription_exists",
    });
    expect(await organizationStatus(organization.id)).toBe("active");
    expect(deleteMediaMock).not.toHaveBeenCalled();
    expect(await tdb.select().from(schema.media)).toHaveLength(4);
    const esps = await tdb.select().from(schema.espConfigs);
    expect(esps.every((esp) => esp.status !== "retired" && esp.encryptedSecret)).toBe(
      true,
    );
  });

  it("lists organizations with the caller's role", async () => {
    const owner = await insertUser("Owner");
    const admin = await insertUser("Admin");
    const { organization } = await seedOrganization(owner, "acme");
    await addOrganizationMemberByEmail(organization.id, admin.email, "admin");
    authState.userId = admin.id;

    const response = await requestApp(app(), "/organizations");

    expect(response.status).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        organizationId: organization.organizationId,
        role: "admin",
      }),
    ]);
  });
});
