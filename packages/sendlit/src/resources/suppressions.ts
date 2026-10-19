import { contract } from "@sendlit/api-contract";
import { type Body, type HttpClient, type Ok, paginate, type Query } from "../http";
import { assertId } from "../validate";

const routes = contract.suppressions;

export type Suppression = Ok<typeof routes.get>;
export type ListSuppressionsQuery = Query<typeof routes.list>;
export type ReleaseSuppressionInput = Body<typeof routes.release>;

/** The team's do-not-send list. */
export class Suppressions {
  constructor(private readonly http: HttpClient) {}

  async list(query: ListSuppressionsQuery = {}): Promise<Ok<typeof routes.list>> {
    return this.http.request(routes.list, { query });
  }

  listAll(
    query: Omit<ListSuppressionsQuery, "offset"> = {},
  ): AsyncGenerator<Suppression, void, undefined> {
    return paginate((offset) => this.list({ ...query, offset }));
  }

  async get(suppressionId: string): Promise<Suppression> {
    return this.http.request(routes.get, {
      params: { suppressionId: assertId(suppressionId, "suppressionId") },
    });
  }

  /** Complaint suppressions can't be released (409
   * `suppression_not_releasable`). */
  async release(
    suppressionId: string,
    input: ReleaseSuppressionInput = {},
  ): Promise<Suppression> {
    return this.http.request(routes.release, {
      params: { suppressionId: assertId(suppressionId, "suppressionId") },
      body: input,
    });
  }
}
