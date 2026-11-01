import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const createTransactionalEmail = vi.fn();
const getTransactionalEmailByTxeId = vi.fn();
const listTransactionalEmails = vi.fn();
const countTransactionalEmails = vi.fn();
const toPublicTransactionalEmail = vi.fn((row: any, options: any) => ({
  txeId: row.txeId,
  ...(options.includeHtml ? { html: row.html } : {}),
}));
mock.module("../../transactional/queries", () => ({
  createTransactionalEmail,
  getTransactionalEmailByTxeId,
  listTransactionalEmails,
  countTransactionalEmails,
  toPublicTransactionalEmail,
}));

const { transactionalTools } = await import("./transactional");
const { PlanGateError } = await import("../../billing/errors");

const signal = new AbortController().signal;
const context = {
  authKind: "team_key" as const,
  teamId: "team-1",
  user: null,
  scopes: [] as string[],
  requestId: "",
  clientIp: "",
  replayHeaders: {},
};
const tools = new Map(transactionalTools().map((tool) => [tool.name, tool]));
const call = (name: string, args: Record<string, unknown>, ctx: any = context) =>
  tools.get(name)!.handler({ context: ctx, args, signal }) as Promise<any>;

beforeEach(() => {
  for (const fn of [
    createTransactionalEmail,
    getTransactionalEmailByTxeId,
    listTransactionalEmails,
    countTransactionalEmails,
  ]) {
    fn.mockReset();
  }
});

describe("MCP transactional tools", () => {
  it("sends an email for the context's team", async () => {
    createTransactionalEmail.mockResolvedValue({ txeId: "txe_1", status: "queued" });
    await expect(
      call("send_email", {
        to: "reader@example.com",
        subject: "Receipt",
        html: "<p>Thanks!</p>",
        idempotencyKey: "key-1",
      }),
    ).resolves.toEqual({ txeId: "txe_1", status: "queued" });
    expect(createTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        to: "reader@example.com",
        html: "<p>Thanks!</p>",
        idempotencyKey: "key-1",
      }),
    );
  });

  it("needs the emails:send scope over OAuth", async () => {
    const oauth = { ...context, authKind: "oauth", scopes: ["emails:read"] };
    await expect(
      call(
        "send_email",
        { to: "a@example.com", subject: "Hi", html: "<p>hi</p>" },
        oauth,
      ),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "insufficient_scope", requiredScope: "emails:send" },
      },
    });
    expect(createTransactionalEmail).not.toHaveBeenCalled();
  });

  it("maps each send failure to a platform code, keeping the REST reason", async () => {
    const cases: Array<[string, string]> = [
      ["invalid_content", "validation_failed"],
      ["template_not_found", "not_found"],
      ["template_not_transactional", "validation_failed"],
      ["marketing_variables_not_allowed", "validation_failed"],
      ["esp_not_configured", "conflict"],
      ["esp_not_found", "not_found"],
      ["recipient_suppressed", "conflict"],
    ];
    for (const [reason, code] of cases) {
      createTransactionalEmail.mockRejectedValueOnce(new Error(reason));
      const result = await call("send_email", {
        to: "a@example.com",
        subject: "Hi",
        html: "<p>hi</p>",
      });
      expect(result.error).toMatchObject({ code, safeDetails: { reason } });
      expect(typeof result.error.safeDetails.message).toBe("string");
    }
  });

  it("lists the missing template variables", async () => {
    createTransactionalEmail.mockRejectedValueOnce(
      Object.assign(new Error("missing_template_variables"), {
        missingVariables: ["customer.name", "otp"],
      }),
    );
    await expect(
      call("send_email", { to: "a@example.com", subject: "Hi", templateId: "tpl_1" }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        safeDetails: {
          reason: "missing_template_variables",
          message: "Missing required template variables: customer.name, otp",
        },
      },
    });
  });

  it("keeps plan limits, and rethrows anything unexpected", async () => {
    createTransactionalEmail.mockRejectedValueOnce(
      new PlanGateError("plan_limit_reached", { limit: 100, nested: { a: 1 } }),
    );
    await expect(
      call("send_email", { to: "a@example.com", subject: "Hi", html: "<p>hi</p>" }),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
        safeDetails: { reason: "plan_limit_reached", limit: 100 },
      },
    });

    createTransactionalEmail.mockRejectedValueOnce(new Error("boom"));
    await expect(
      call("send_email", { to: "a@example.com", subject: "Hi", html: "<p>hi</p>" }),
    ).rejects.toThrow("boom");
  });

  it("returns another team's email as not found", async () => {
    getTransactionalEmailByTxeId.mockResolvedValue({
      txeId: "txe_1",
      teamId: "team-2",
    });
    await expect(call("get_email", { txeId: "txe_1" })).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    getTransactionalEmailByTxeId.mockResolvedValue({
      txeId: "txe_1",
      teamId: "team-1",
      html: "<p>x</p>",
    });
    await expect(call("get_email", { txeId: "txe_1" })).resolves.toEqual({
      txeId: "txe_1",
      html: "<p>x</p>",
    });
  });

  it("lists the team's emails without their HTML", async () => {
    listTransactionalEmails.mockResolvedValue([{ txeId: "txe_1", html: "<p>x</p>" }]);
    countTransactionalEmails.mockResolvedValue(1);
    await expect(call("list_emails", { status: "sent", offset: 2 })).resolves.toEqual({
      items: [{ txeId: "txe_1" }],
      total: 1,
    });
    expect(listTransactionalEmails).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", status: "sent", offset: 2 }),
    );
    expect(countTransactionalEmails).toHaveBeenCalledWith(
      "team-1",
      expect.objectContaining({ status: "sent" }),
    );
  });
});
