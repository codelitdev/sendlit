import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok } from "../http";
import { assertId } from "../validate";

const routes = contract.segments;

export type Segment = Ok<typeof routes.get>;
export type CreateSegmentInput = Body<typeof routes.create>;
export type UpdateSegmentInput = Body<typeof routes.update>;

export class Segments {
    constructor(private readonly http: HttpClient) {}

    async create(input: CreateSegmentInput): Promise<Segment> {
        return this.http.request(routes.create, { body: input });
    }

    async list(): Promise<Segment[]> {
        return this.http.request(routes.list);
    }

    async get(segmentId: string): Promise<Segment> {
        return this.http.request(routes.get, {
            params: { segmentId: assertId(segmentId, "segmentId") },
        });
    }

    async update(
        segmentId: string,
        input: UpdateSegmentInput,
    ): Promise<Segment> {
        return this.http.request(routes.update, {
            params: { segmentId: assertId(segmentId, "segmentId") },
            body: input,
        });
    }

    async remove(segmentId: string): Promise<void> {
        await this.http.request(routes.remove, {
            params: { segmentId: assertId(segmentId, "segmentId") },
        });
    }
}
