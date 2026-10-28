import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok } from "../http";
import { encodeSegment } from "../validate";

const routes = contract.events;

export type TrackEventInput = Body<typeof routes.track>;
export type TrackEventResponse = Ok<typeof routes.track>;
export type EventDefinition = Ok<typeof routes.definitions>["items"][number];
export type EventDefinitionDetail = Ok<typeof routes.definition>;
export type CreateEventDefinitionInput = Body<typeof routes.createDefinition>;
export type UpdateEventDefinitionInput = Body<typeof routes.updateDefinition>;

/** The team's list of events: registered on first receipt, or by hand so
 * sequences can be built before the first event is sent. */
export class EventDefinitions {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Ok<typeof routes.definitions>> {
    return this.http.request(routes.definitions);
  }

  /** One event with its last received payload. Names are case-sensitive. */
  async get(name: string): Promise<EventDefinitionDetail> {
    return this.http.request(routes.definition, {
      params: { name: encodeSegment(name, "name") },
    });
  }

  async create(input: CreateEventDefinitionInput): Promise<EventDefinitionDetail> {
    return this.http.request(routes.createDefinition, { body: input });
  }

  /** `properties` replaces the declared set; observed keys stay. */
  async update(
    name: string,
    input: UpdateEventDefinitionInput,
  ): Promise<EventDefinitionDetail> {
    return this.http.request(routes.updateDefinition, {
      params: { name: encodeSegment(name, "name") },
      body: input,
    });
  }

  /** Removes the event from the list. Stored events are kept, and the API
   * refuses (409 `event_definition_in_use`) while a sequence uses it. */
  async delete(name: string): Promise<void> {
    await this.http.request(routes.deleteDefinition, {
      params: { name: encodeSegment(name, "name") },
    });
  }
}

/** Custom events, which start sequences triggered by "a custom event is
 * received". */
export class Events {
  readonly definitions: EventDefinitions;

  constructor(private readonly http: HttpClient) {
    this.definitions = new EventDefinitions(http);
  }

  /**
   * Records an event for one contact (by `email` or `contactId`) and starts
   * every active sequence listening for `eventName`.
   *
   * - An unknown `email` creates the contact, since `createContact`
   *   defaults to `true`. Pass `false` to get a 404 instead. An unknown
   *   `contactId` is always a 404.
   * - The same `idempotencyKey` within 30 days stores one event and
   *   returns the original with `duplicate: true`. With a key, the SDK
   *   also retries the call on 5xx and network errors.
   * - `backfill: true` stores history without starting sequences. Events
   *   whose `occurredAt` is more than 72 hours old never start one either.
   */
  async track(input: TrackEventInput): Promise<TrackEventResponse> {
    return this.http.request(routes.track, {
      body: input,
      retrySafe: !!input.idempotencyKey,
    });
  }
}
