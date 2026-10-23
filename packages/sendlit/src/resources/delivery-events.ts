import { contract } from "@sendlit/api-contract";
import { type HttpClient, type Ok, paginate, type Query } from "../http";
import { assertId } from "../validate";

const routes = contract.deliveryEvents;

export type DeliveryEvent = Ok<typeof routes.get>;
export type ListDeliveryEventsQuery = Query<typeof routes.list>;

/** Normalized delivery history (delivered, bounced, complained, …). */
export class DeliveryEvents {
  constructor(private readonly http: HttpClient) {}

  async list(query: ListDeliveryEventsQuery = {}): Promise<Ok<typeof routes.list>> {
    return this.http.request(routes.list, { query });
  }

  listAll(
    query: Omit<ListDeliveryEventsQuery, "offset"> = {},
  ): AsyncGenerator<DeliveryEvent, void, undefined> {
    return paginate((offset) => this.list({ ...query, offset }));
  }

  async get(eventId: string): Promise<DeliveryEvent> {
    return this.http.request(routes.get, {
      params: { eventId: assertId(eventId, "eventId") },
    });
  }
}
