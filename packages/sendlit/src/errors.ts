/**
 * Every failed SendLit call rejects with a `SendLitError`. `code` is the
 * API's stable machine-readable `error` value (e.g. `team_not_found`,
 * `missing_template_variables`) — branch on it rather than on `message`.
 */
export class SendLitError extends Error {
  /** HTTP status, or `0` when no response was received. */
  readonly status: number;
  readonly code: string;
  /** The parsed response body, when there was one. */
  readonly body: unknown;
  readonly headers?: Headers;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    body?: unknown;
    headers?: Headers;
    cause?: unknown;
  }) {
    super(init.message);
    this.name = "SendLitError";
    this.status = init.status;
    this.code = init.code;
    this.body = init.body;
    this.headers = init.headers;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  static fromResponse(status: number, body: unknown, headers?: Headers): SendLitError {
    const fields =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const text = (value: unknown) =>
      typeof value === "string" && value.length > 0 ? value : undefined;
    const code =
      text(fields.error) ??
      // ts-rest's request-validation 400s carry `message` + `*Errors`
      // instead of an `error` code.
      (status === 400 ? "validation_error" : `http_${status}`);
    const message =
      text(fields.error_description) ??
      text(fields.message) ??
      text(fields.error) ??
      (typeof body === "string" && body ? body : undefined) ??
      `Request failed with status ${status}`;
    return new SendLitError({ status, code, message, body, headers });
  }
}
