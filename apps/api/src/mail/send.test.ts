import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

const sendMailMock = mock();
const getTeamTransportMock = mock();
const captureErrorMock = mock();
const captureEventMock = mock();
const assertMailingAddressConfiguredMock = mock();

// `send.ts` also imports `getEspTransport`; Bun requires every imported
// name to exist on the mock, so stub it (no test here exercises it).
mock.module("./transport", () => ({
  getEspTransport: mock(),
  getTeamTransport: getTeamTransportMock,
}));

const acquireCapacityMock = mock(async () => async () => undefined);
mock.module("./rate-limit", () => {
  class SendDeferredError extends Error {
    constructor(
      readonly retryAfterMs: number,
      message = "send_rate_limited",
    ) {
      super(message);
    }
  }
  return {
    SendDeferredError,
    acquireEspSendCapacity: acquireCapacityMock,
    throttlingRetryDelay: (error: { responseCode?: number }) =>
      error?.responseCode === 454 ? 60_000 : null,
  };
});

mock.module("../observability", () => ({
  captureError: captureErrorMock,
  captureEvent: captureEventMock,
}));

mock.module("../services/log", () => ({
  default: {
    info: mock(),
    warn: mock(),
  },
}));

mock.module("../settings/general/queries", () => ({
  assertMailingAddressConfigured: assertMailingAddressConfiguredMock,
}));

// Bun stand-in for `vi.resetModules()`: a fresh specifier per test gives a
// fresh instance of the module under test (its dependencies are all mocked).
let moduleCase = 0;
const loadSend = async () =>
  (await import(`./send?case=${moduleCase}`)) as typeof import("./send");

describe("sendMail", () => {
  beforeEach(() => {
    moduleCase++;
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    assertMailingAddressConfiguredMock.mockResolvedValue(undefined);
  });

  it("does not send when the team has no mailing address", async () => {
    assertMailingAddressConfiguredMock.mockRejectedValueOnce(
      new Error("mailing_address_required"),
    );
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendMail } = await loadSend();

    await expect(
      sendMail({
        purpose: "campaign",
        from: "Sender <sender@example.com>",
        to: "contact@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
        teamId: "team-1",
      }),
    ).rejects.toThrow("mailing_address_required");

    expect(getTeamTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("fails clearly when a team has no ESP configured", async () => {
    getTeamTransportMock.mockResolvedValue(null);
    const { sendMail } = await loadSend();

    await expect(
      sendMail({
        purpose: "campaign",
        from: "Sender <sender@example.com>",
        to: "contact@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
        teamId: "team-1",
      }),
    ).rejects.toThrow("Team ESP is not configured.");

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(captureErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "mail.send",
        teamId: "team-1",
        severity: "critical",
      }),
    );
  });

  it("fails closed without an ESP outside production too", async () => {
    process.env.NODE_ENV = "test";
    getTeamTransportMock.mockResolvedValue(null);
    const { sendMail } = await loadSend();

    await expect(
      sendMail({
        purpose: "campaign",
        from: "Sender <sender@example.com>",
        to: "contact@example.com",
        subject: "Hello",
        html: "<p>Hello</p>",
        teamId: "team-1",
      }),
    ).rejects.toThrow("Team ESP is not configured.");
  });

  it("waits for the ESP's send slot and defers on provider throttling", async () => {
    const espSendMail = mock()
      .mockResolvedValueOnce({ messageId: "<a>", response: "250 ok" })
      .mockRejectedValueOnce(
        Object.assign(new Error("Throttling failure: Maximum sending rate exceeded."), {
          responseCode: 454,
        }),
      );
    const { getEspTransport } = await import("./transport");
    (getEspTransport as any).mockResolvedValue({ sendMail: espSendMail });
    const { sendMail } = await loadSend();
    const input = {
      purpose: "transactional" as const,
      from: "Sender <sender@example.com>",
      to: "contact@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      teamId: "team-1",
      espConfigId: "esp-internal",
    };

    await sendMail(input);
    expect(acquireCapacityMock).toHaveBeenCalledWith("esp-internal", "transactional");

    const deferred = await sendMail(input).catch((error) => error);
    expect(deferred.retryAfterMs).toBe(60_000);
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("sends through the team's configured ESP", async () => {
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendMail } = await loadSend();

    await sendMail({
      purpose: "campaign",
      from: "Sender <sender@example.com>",
      to: "contact@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      headers: { "List-Unsubscribe": "<mailto:unsubscribe@example.com>" },
      teamId: "team-1",
    });

    expect(sendMailMock).toHaveBeenCalledWith({
      from: "Sender <sender@example.com>",
      to: "contact@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: { "List-Unsubscribe": "<mailto:unsubscribe@example.com>" },
    });
    expect(captureEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_sent",
        source: "mail.send",
        teamId: "team-1",
      }),
    );
  });

  it("sends the caller's plain text instead of generating one", async () => {
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendMail } = await loadSend();

    await sendMail({
      purpose: "transactional",
      from: "Sender <sender@example.com>",
      to: "contact@example.com",
      subject: "Hello",
      html: '<p>Hi <a href="https://example.com">there</a></p>',
      text: "Custom text",
      replyTo: "support@example.com",
      teamId: "team-1",
    });

    expect(sendMailMock.mock.calls.at(-1)?.[0]).toMatchObject({
      text: "Custom text",
      replyTo: "support@example.com",
    });
  });

  it("passes SendGrid's JSON header through unencoded", async () => {
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendMail } = await loadSend();
    const json = JSON.stringify({
      filters: { clicktrack: { settings: { enable: 0 } } },
    });

    await sendMail({
      purpose: "transactional",
      from: "Sender <sender@example.com>",
      to: "contact@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      headers: { "X-SMTPAPI": json, "X-Other": "kept" },
      teamId: "team-1",
    });

    expect(sendMailMock.mock.calls.at(-1)?.[0].headers).toEqual({
      "X-SMTPAPI": { prepared: true, value: json },
      "X-Other": "kept",
    });
  });

  it("sends transactional mail without requiring a mailing address", async () => {
    assertMailingAddressConfiguredMock.mockRejectedValueOnce(
      new Error("mailing_address_required"),
    );
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendMail } = await loadSend();

    await expect(
      sendMail({
        purpose: "transactional",
        from: "Sender <sender@example.com>",
        to: "contact@example.com",
        subject: "Your sign-in code",
        html: "<p>123456</p>",
        teamId: "team-1",
      }),
    ).resolves.toEqual({ messageId: null, providerResponse: null });

    expect(assertMailingAddressConfiguredMock).not.toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("does not require a mailing address to test an ESP", async () => {
    assertMailingAddressConfiguredMock.mockRejectedValueOnce(
      new Error("mailing_address_required"),
    );
    getTeamTransportMock.mockResolvedValue({ sendMail: sendMailMock });
    const { sendTestMail } = await loadSend();

    await expect(
      sendTestMail({
        from: "Sender <sender@example.com>",
        to: "owner@example.com",
        subject: "ESP test",
        html: "<p>Test</p>",
        teamId: "team-1",
      }),
    ).resolves.toBeUndefined();

    expect(assertMailingAddressConfiguredMock).not.toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
