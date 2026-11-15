import { contract } from "@sendlit/api-contract";
import type { HttpClient, Ok, Query } from "../http";

const routes = contract.overview;

/** The team's dashboard numbers: contacts, sends, opens and clicks over a
 * period. */
export type Overview = Ok<typeof routes.get>;
export type OverviewQuery = Query<typeof routes.get>;

export class OverviewResource {
  constructor(private readonly http: HttpClient) {}

  async get(query: OverviewQuery = {}): Promise<Overview> {
    return this.http.request(routes.get, { query });
  }
}
