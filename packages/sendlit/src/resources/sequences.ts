import { contract } from "@sendlit/api-contract";
import { type Body, type HttpClient, type Ok, paginate, type Query } from "../http";
import { assertId } from "../validate";

const routes = contract.sequences;

/** A broadcast or a sequence — they share one resource, told apart by
 * `type`. */
export type Sequence = Ok<typeof routes.get>;
export type SequenceStats = Ok<typeof routes.stats>;
export type CreateSequenceInput = Body<typeof routes.create>;
export type UpdateSequenceInput = Body<typeof routes.update>;
export type AddSequenceEmailInput = Body<typeof routes.addEmail>;
export type UpdateSequenceEmailInput = Body<typeof routes.updateEmail>;
export type PublishSequenceChangesInput = Body<typeof routes.publishChanges>;
export type DiscardSequenceChangesInput = Body<typeof routes.discardChanges>;
export type SequenceEmailVersion = Ok<typeof routes.emailVersions>["items"][number];
export type ListSequencesQuery = Query<typeof routes.list>;
export type ListSequenceSubscribersQuery = Query<typeof routes.subscribers>;

export class Sequences {
  constructor(private readonly http: HttpClient) {}

  async create(input: CreateSequenceInput): Promise<Sequence> {
    return this.http.request(routes.create, { body: input });
  }

  async list(query: ListSequencesQuery): Promise<Ok<typeof routes.list>> {
    return this.http.request(routes.list, { query });
  }

  listAll(
    query: Omit<ListSequencesQuery, "offset">,
  ): AsyncGenerator<Sequence, void, undefined> {
    return paginate((offset) => this.list({ ...query, offset }));
  }

  async get(sequenceId: string): Promise<Sequence> {
    return this.http.request(routes.get, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
    });
  }

  async update(sequenceId: string, input: UpdateSequenceInput): Promise<Sequence> {
    return this.http.request(routes.update, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
      body: input,
    });
  }

  async remove(sequenceId: string): Promise<void> {
    await this.http.request(routes.remove, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
    });
  }

  async addEmail(sequenceId: string, input: AddSequenceEmailInput): Promise<Sequence> {
    return this.http.request(routes.addEmail, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
      body: input,
    });
  }

  async updateEmail(
    sequenceId: string,
    emailId: string,
    input: UpdateSequenceEmailInput,
  ): Promise<Sequence> {
    return this.http.request(routes.updateEmail, {
      params: {
        sequenceId: assertId(sequenceId, "sequenceId"),
        emailId: assertId(emailId, "emailId"),
      },
      body: input,
    });
  }

  /** Publishes unpublished email changes (drafts) of a broadcast or
   * sequence, so sends use them. While it's active, `updateEmail` saves
   * subject and content changes as a draft. */
  async publishChanges(
    sequenceId: string,
    input: PublishSequenceChangesInput = {},
  ): Promise<Sequence> {
    return this.http.request(routes.publishChanges, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
      body: input,
    });
  }

  /** Throws away unpublished email changes. Sends are not affected. */
  async discardChanges(
    sequenceId: string,
    input: DiscardSequenceChangesInput = {},
  ): Promise<Sequence> {
    return this.http.request(routes.discardChanges, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
      body: input,
    });
  }

  /** The versions an email has been published with, live one first. */
  async emailVersions(
    sequenceId: string,
    emailId: string,
  ): Promise<SequenceEmailVersion[]> {
    const { items } = await this.http.request(routes.emailVersions, {
      params: {
        sequenceId: assertId(sequenceId, "sequenceId"),
        emailId: assertId(emailId, "emailId"),
      },
    });
    return items;
  }

  /** Loads an earlier published version into the email's draft; publish
   * it with `publishChanges` to roll back. */
  async restoreEmailVersion(
    sequenceId: string,
    emailId: string,
    versionId: string,
  ): Promise<Sequence> {
    return this.http.request(routes.restoreEmailVersion, {
      params: {
        sequenceId: assertId(sequenceId, "sequenceId"),
        emailId: assertId(emailId, "emailId"),
        versionId: assertId(versionId, "versionId"),
      },
    });
  }

  async removeEmail(sequenceId: string, emailId: string): Promise<Sequence> {
    return this.http.request(routes.removeEmail, {
      params: {
        sequenceId: assertId(sequenceId, "sequenceId"),
        emailId: assertId(emailId, "emailId"),
      },
    });
  }

  /** Sends a broadcast, or activates a sequence so its trigger starts
   * enrolling contacts. Requires a mailing address in general settings. */
  async start(sequenceId: string): Promise<Sequence> {
    return this.http.request(routes.start, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
    });
  }

  async pause(sequenceId: string): Promise<Sequence> {
    return this.http.request(routes.pause, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
    });
  }

  async stats(sequenceId: string): Promise<SequenceStats> {
    return this.http.request(routes.stats, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
    });
  }

  /** IDs of contacts that have received this broadcast or sequence. */
  async subscribers(
    sequenceId: string,
    query: ListSequenceSubscribersQuery = {},
  ): Promise<string[]> {
    return this.http.request(routes.subscribers, {
      params: { sequenceId: assertId(sequenceId, "sequenceId") },
      query,
    });
  }
}
