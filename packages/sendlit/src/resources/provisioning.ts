import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok } from "../http";
import { assertId } from "../validate";

const routes = contract.provisioning;

export type ProvisionTeamInput = Body<typeof routes.provisionTeam>;
export type ProvisionTeamResponse = Ok<typeof routes.provisionTeam>;
export type ProvisionedTeam = Ok<typeof routes.getTeam>;
export type UpdateProvisionedTeamInput = Body<typeof routes.updateTeam>;
export type CreateTeamKeyInput = Body<typeof routes.createTeamKey>;
export type CreatedTeamKey = Ok<typeof routes.createTeamKey>;
export type ProvisionedTeamUsage = Ok<typeof routes.getTeamUsage>;

/**
 * One SendLit team per tenant of a multi-tenant platform. Requires an
 * organization key (`sl_org_live_…`) with the scope noted on each method.
 */
export class Provisioning {
  constructor(private readonly http: HttpClient) {}

  /**
   * Find-or-create the team for `externalId` (`teams:provision`). Only the
   * first call returns the plaintext team key (`apiKey`); replays return
   * `created: false, apiKey: null`, so it's safe to retry.
   */
  async provisionTeam(input: ProvisionTeamInput): Promise<ProvisionTeamResponse> {
    return this.http.request(routes.provisionTeam, {
      body: input,
      retrySafe: true,
    });
  }

  /** `teams:read` */
  async getTeam(teamId: string): Promise<ProvisionedTeam> {
    return this.http.request(routes.getTeam, {
      params: { teamId: assertId(teamId, "teamId") },
    });
  }

  /** `teams:manage` */
  async updateTeam(
    teamId: string,
    input: UpdateProvisionedTeamInput,
  ): Promise<ProvisionedTeam> {
    return this.http.request(routes.updateTeam, {
      params: { teamId: assertId(teamId, "teamId") },
      body: input,
    });
  }

  /** Replaces the team's integration key (`teams:keys`); keys previously
   * issued through provisioning are revoked. */
  async createTeamKey(
    teamId: string,
    input: CreateTeamKeyInput,
  ): Promise<CreatedTeamKey> {
    return this.http.request(routes.createTeamKey, {
      params: { teamId: assertId(teamId, "teamId") },
      body: input,
    });
  }

  /** `teams:manage` */
  async suspendTeam(teamId: string): Promise<ProvisionedTeam> {
    return this.http.request(routes.suspendTeam, {
      params: { teamId: assertId(teamId, "teamId") },
    });
  }

  /** `teams:manage` */
  async resumeTeam(teamId: string): Promise<ProvisionedTeam> {
    return this.http.request(routes.resumeTeam, {
      params: { teamId: assertId(teamId, "teamId") },
    });
  }

  /** Soft-deprovisions the team (`teams:manage`). There is no unarchive. */
  async archiveTeam(teamId: string): Promise<void> {
    await this.http.request(routes.archiveTeam, {
      params: { teamId: assertId(teamId, "teamId") },
    });
  }

  /** `usage:read` */
  async getTeamUsage(teamId: string): Promise<ProvisionedTeamUsage> {
    return this.http.request(routes.getTeamUsage, {
      params: { teamId: assertId(teamId, "teamId") },
    });
  }
}
