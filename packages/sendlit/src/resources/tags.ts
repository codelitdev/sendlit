import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok } from "../http";
import { encodeSegment } from "../validate";

const routes = contract.tags;

/** A tag in use in the team, with how many contacts carry it. */
export type Tag = Ok<typeof routes.list>["items"][number];
/** Where a tag is still used (segments, sequence triggers, ...), so it can be
 * shown before the tag is renamed or deleted. */
export type TagReferences = Ok<typeof routes.references>;
export type RenameTagInput = Body<typeof routes.rename>;
export type RenameTagResult = Ok<typeof routes.rename>;
export type RemoveTagResult = Ok<typeof routes.remove>;

export class Tags {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Ok<typeof routes.list>> {
    return this.http.request(routes.list);
  }

  async references(tag: string): Promise<TagReferences> {
    return this.http.request(routes.references, {
      params: { tag: encodeSegment(tag, "tag") },
    });
  }

  /** Renames a tag on every contact and everywhere it's referenced. */
  async rename(tag: string, input: RenameTagInput): Promise<RenameTagResult> {
    return this.http.request(routes.rename, {
      params: { tag: encodeSegment(tag, "tag") },
      body: input,
    });
  }

  /** Removes a tag from every contact. */
  async remove(tag: string): Promise<RemoveTagResult> {
    return this.http.request(routes.remove, {
      params: { tag: encodeSegment(tag, "tag") },
    });
  }
}
