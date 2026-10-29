import { contract } from "@sendlit/api-contract";
import { type Body, type HttpClient, type Ok, paginate, type Query } from "../http";
import { assertId, encodeSegment } from "../validate";

const routes = contract.contacts;

export type Contact = Ok<typeof routes.get>;
export type CreateContactInput = Body<typeof routes.create>;
export type UpdateContactInput = Body<typeof routes.update>;
export type ListContactsQuery = Query<typeof routes.list>;
export type ContactDelivery = Ok<typeof routes.deliveries>[number];
export type ContactEvent = Ok<typeof routes.events>["items"][number];
export type ListContactEventsQuery = Query<typeof routes.events>;

export class Contacts {
  constructor(private readonly http: HttpClient) {}

  /**
   * Find-or-create by email within the team. A newly created contact fires
   * `subscriber:added`, enrolling it in active sequences with that trigger.
   * If the email already exists, the existing contact is returned
   * unchanged and **no event fires**, so it is not re-enrolled. Tags passed
   * here don't fire `tag:added`.
   */
  async create(input: CreateContactInput): Promise<Contact> {
    return this.http.request(routes.create, {
      body: input,
      retrySafe: true,
    });
  }

  async list(query: ListContactsQuery = {}): Promise<Ok<typeof routes.list>> {
    return this.http.request(routes.list, { query });
  }

  /** Iterates every contact matching `query`, fetching pages lazily. */
  listAll(
    query: Omit<ListContactsQuery, "offset"> = {},
  ): AsyncGenerator<Contact, void, undefined> {
    return paginate((offset) => this.list({ ...query, offset }));
  }

  async get(contactId: string): Promise<Contact> {
    return this.http.request(routes.get, {
      params: { contactId: assertId(contactId, "contactId") },
    });
  }

  async update(contactId: string, input: UpdateContactInput): Promise<Contact> {
    return this.http.request(routes.update, {
      params: { contactId: assertId(contactId, "contactId") },
      body: input,
    });
  }

  async remove(contactId: string): Promise<void> {
    await this.http.request(routes.remove, {
      params: { contactId: assertId(contactId, "contactId") },
    });
  }

  async addTag(contactId: string, tag: string): Promise<Contact> {
    return this.http.request(routes.addTag, {
      params: {
        contactId: assertId(contactId, "contactId"),
        tag: encodeSegment(tag, "tag"),
      },
      retrySafe: true,
    });
  }

  async removeTag(contactId: string, tag: string): Promise<Contact> {
    return this.http.request(routes.removeTag, {
      params: {
        contactId: assertId(contactId, "contactId"),
        tag: encodeSegment(tag, "tag"),
      },
    });
  }

  /** Broadcast and sequence emails delivered to this contact. */
  async deliveries(contactId: string): Promise<ContactDelivery[]> {
    return this.http.request(routes.deliveries, {
      params: { contactId: assertId(contactId, "contactId") },
    });
  }

  /** Custom events received for this contact, newest first, with the
   * sequences each one started. */
  async events(
    contactId: string,
    query: ListContactEventsQuery = {},
  ): Promise<Ok<typeof routes.events>> {
    return this.http.request(routes.events, {
      params: { contactId: assertId(contactId, "contactId") },
      query,
    });
  }
}
