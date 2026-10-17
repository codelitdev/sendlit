import { contract } from "@sendlit/api-contract";
import {
    paginate,
    type Body,
    type HttpClient,
    type Ok,
    type Query,
} from "../http";
import { assertId } from "../validate";

const routes = contract.transactional;

export type SendEmailInput = Body<typeof routes.send>;
export type SendEmailResponse = Ok<typeof routes.send>;
export type TransactionalEmail = Ok<typeof routes.list>["items"][number];
export type TransactionalEmailDetail = Ok<typeof routes.get>;
export type ListEmailsQuery = Query<typeof routes.list>;

/** Transactional (single, API-triggered) emails. */
export class Emails {
    constructor(private readonly http: HttpClient) {}

    /**
     * Queues one email and resolves with its id and initial status; poll
     * `get` for delivery progress. Passing `idempotencyKey` makes the call
     * safe to retry, so the SDK retries it on 5xx and network errors too.
     */
    async send(input: SendEmailInput): Promise<SendEmailResponse> {
        return this.http.request(routes.send, {
            body: input,
            retrySafe: !!input.idempotencyKey,
        });
    }

    async get(txeId: string): Promise<TransactionalEmailDetail> {
        return this.http.request(routes.get, {
            params: { txeId: assertId(txeId, "txeId") },
        });
    }

    async list(query: ListEmailsQuery = {}): Promise<Ok<typeof routes.list>> {
        return this.http.request(routes.list, { query });
    }

    listAll(
        query: Omit<ListEmailsQuery, "offset"> = {},
    ): AsyncGenerator<TransactionalEmail, void, undefined> {
        return paginate((offset) => this.list({ ...query, offset }));
    }
}
