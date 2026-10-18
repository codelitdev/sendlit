import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signSnsMessage,
  snsNotification,
  TEST_SNS_PUBLIC_KEY_PEM,
  TEST_TOPIC_ARN,
} from "../../test/sns";
import { normalizeSesEvent, sesAdapter } from "./ses";

const mail = {
  timestamp: "2026-10-14T09:59:00.000Z",
  messageId: "0100018f-ses-message-id-000000",
  destination: ["a@example.com", "b@example.com"],
  headers: [{ name: "Subject", value: "Private subject" }],
  tags: { sendlit_message_id: ["msg_abc123"] },
};

function body(message: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(message));
}

describe("normalizeSesEvent", () => {
  it("maps a Permanent bounce to one hard bounce per recipient", () => {
    const events = normalizeSesEvent(
      {
        eventType: "Bounce",
        mail,
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          timestamp: "2026-10-14T10:00:00.000Z",
          remoteMtaIp: "203.0.113.5",
          bouncedRecipients: [
            {
              emailAddress: "a@example.com",
              action: "failed",
              status: "5.1.1",
              diagnosticCode: "smtp; 550 5.1.1 user unknown",
            },
            { emailAddress: "b@example.com" },
          ],
        },
      },
      "sns-1",
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      providerEventKey: "Bounce:sns-1:a@example.com",
      providerMessageId: mail.messageId,
      sendlitMessageId: "msg_abc123",
      recipientEmail: "a@example.com",
      eventType: "hard_bounce",
      bounceClass: "permanent",
      smtpCode: 550,
      enhancedStatusCode: "5.1.1",
      reason: "smtp; 550 5.1.1 user unknown",
      remoteMta: "203.0.113.5",
    });
    expect(events[0].occurredAt.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(events[1].providerEventKey).toBe("Bounce:sns-1:b@example.com");
  });

  it("maps Transient and Undetermined bounces to soft bounces", () => {
    const bounce = (bounceType: string) =>
      normalizeSesEvent(
        {
          notificationType: "Bounce",
          mail,
          bounce: {
            bounceType,
            bouncedRecipients: [{ emailAddress: "a@example.com" }],
          },
        },
        "sns-1",
      )[0];
    expect(bounce("Transient")).toMatchObject({
      eventType: "soft_bounce",
      bounceClass: "transient",
    });
    expect(bounce("Undetermined")).toMatchObject({
      eventType: "soft_bounce",
      bounceClass: "undetermined",
    });
  });

  it("maps a bounce off SES's own suppression list to a provider suppression", () => {
    const [event] = normalizeSesEvent(
      {
        eventType: "Bounce",
        mail,
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "OnAccountSuppressionList",
          bouncedRecipients: [{ emailAddress: "a@example.com" }],
        },
      },
      "sns-1",
    );
    expect(event.eventType).toBe("suppressed");
  });

  it("maps a complaint and ignores a not-spam feedback report", () => {
    const complaint = (complaintFeedbackType?: string) =>
      normalizeSesEvent(
        {
          eventType: "Complaint",
          mail,
          complaint: {
            complaintFeedbackType,
            complainedRecipients: [{ emailAddress: "a@example.com" }],
          },
        },
        "sns-1",
      );
    expect(complaint("abuse")).toEqual([
      expect.objectContaining({
        eventType: "complaint",
        recipientEmail: "a@example.com",
        reason: "abuse",
      }),
    ]);
    expect(complaint("not-spam")).toEqual([]);
  });

  it("keeps a redacted complaint as one recipient-less event", () => {
    const events = normalizeSesEvent(
      { eventType: "Complaint", mail, complaint: {} },
      "sns-1",
    );
    expect(events).toEqual([
      expect.objectContaining({
        eventType: "complaint",
        recipientEmail: null,
        providerEventKey: "Complaint:sns-1:",
      }),
    ]);
  });

  it("maps Delivery, DeliveryDelay, Reject and RenderingFailure", () => {
    const [delivered] = normalizeSesEvent(
      {
        eventType: "Delivery",
        mail,
        delivery: {
          recipients: ["a@example.com"],
          smtpResponse: "250 2.6.0 Message received",
        },
      },
      "sns-1",
    );
    expect(delivered).toMatchObject({
      eventType: "delivered",
      recipientEmail: "a@example.com",
      smtpCode: 250,
    });

    const [delayed] = normalizeSesEvent(
      {
        eventType: "DeliveryDelay",
        mail,
        deliveryDelay: {
          delayType: "MailboxFull",
          delayedRecipients: [{ emailAddress: "a@example.com", status: "4.2.2" }],
        },
      },
      "sns-1",
    );
    expect(delayed).toMatchObject({
      eventType: "delayed",
      reason: "MailboxFull",
      enhancedStatusCode: "4.2.2",
    });

    const rejected = normalizeSesEvent(
      { eventType: "Reject", mail, reject: { reason: "Bad content" } },
      "sns-1",
    );
    expect(rejected.map((e) => [e.eventType, e.recipientEmail])).toEqual([
      ["rejected", "a@example.com"],
      ["rejected", "b@example.com"],
    ]);

    // Configuration sets spell this one with a space.
    const [failed] = normalizeSesEvent(
      {
        eventType: "Rendering Failure",
        mail,
        failure: { errorMessage: "Missing variable" },
      },
      "sns-1",
    );
    expect(failed).toMatchObject({
      eventType: "failed",
      reason: "Missing variable",
      providerEventKey: "RenderingFailure:sns-1:a@example.com",
    });
  });

  it("ignores engagement events and keeps unknown types as unknown", () => {
    for (const eventType of ["Send", "Open", "Click", "Subscription"]) {
      expect(normalizeSesEvent({ eventType, mail }, "sns-1")).toEqual([]);
    }
    expect(normalizeSesEvent({ eventType: "SomethingNew", mail }, "sns-1")).toEqual([
      expect.objectContaining({ eventType: "unknown" }),
    ]);
  });

  it("drops a tag that isn't a SendLit message id", () => {
    const [event] = normalizeSesEvent(
      {
        eventType: "Delivery",
        mail: { ...mail, tags: { sendlit_message_id: ["../x"] } },
        delivery: { recipients: ["a@example.com"] },
      },
      "sns-1",
    );
    expect(event.sendlitMessageId).toBeNull();
  });
});

describe("sesAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(TEST_SNS_PUBLIC_KEY_PEM));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bounceEvent = {
    eventType: "Bounce",
    mail,
    bounce: {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "a@example.com" }],
    },
  };

  it("verifies a signed message for the expected topic", async () => {
    const result = await sesAdapter.verify({
      rawBody: body(signSnsMessage(snsNotification(bounceEvent))),
      headers: {},
      credential: "",
      expectedTopicArn: TEST_TOPIC_ARN,
    });
    expect(result).toEqual({ valid: true, providerRequestId: "sns-msg-1" });
  });

  it("rejects another topic or an unarmed connection without fetching", async () => {
    const signed = body(signSnsMessage(snsNotification(bounceEvent)));
    expect(
      await sesAdapter.verify({
        rawBody: signed,
        headers: {},
        credential: "",
        expectedTopicArn: "arn:aws:sns:us-east-1:123456789012:someone-else",
      }),
    ).toEqual({ valid: false });
    expect(
      await sesAdapter.verify({
        rawBody: signed,
        headers: {},
        credential: "",
        expectedTopicArn: null,
      }),
    ).toEqual({ valid: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms a subscription through its validated SubscribeURL", async () => {
    fetchMock.mockResolvedValue(new Response("<ok/>"));
    const subscribeUrl = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TEST_TOPIC_ARN)}&Token=tok`;
    const outcome = await sesAdapter.handleControl!(
      body({
        Type: "SubscriptionConfirmation",
        TopicArn: TEST_TOPIC_ARN,
        SubscribeURL: subscribeUrl,
      }),
    );
    expect(outcome).toBe("subscription_confirmed");
    expect(fetchMock).toHaveBeenCalledWith(
      subscribeUrl,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("refuses to fetch an off-Amazon SubscribeURL", async () => {
    const outcome = await sesAdapter.handleControl!(
      body({
        Type: "SubscriptionConfirmation",
        TopicArn: TEST_TOPIC_ARN,
        SubscribeURL: "https://evil.test/?Action=ConfirmSubscription",
      }),
    );
    expect(outcome).toBe("subscription_confirm_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unsubscribe and passes notifications through", async () => {
    expect(
      await sesAdapter.handleControl!(body({ Type: "UnsubscribeConfirmation" })),
    ).toBe("unsubscribed");
    expect(
      await sesAdapter.handleControl!(body(snsNotification(bounceEvent))),
    ).toBeNull();
  });

  it("strips mail.headers before storage", () => {
    const stored = JSON.parse(
      sesAdapter.redactForStorage!(body(snsNotification(bounceEvent))).toString("utf8"),
    );
    const event = JSON.parse(stored.Message);
    expect(event.mail.headers).toBeUndefined();
    expect(event.mail.messageId).toBe(mail.messageId);
    expect(stored.MessageId).toBe("sns-msg-1");
  });

  it("keeps raw payloads only for problem events", () => {
    const retain = (eventType: string) =>
      sesAdapter.retainPayloadAfterProcessing!(
        body(snsNotification({ eventType, mail })),
      );
    expect(retain("Bounce")).toBe(true);
    expect(retain("Complaint")).toBe(true);
    expect(retain("Reject")).toBe(true);
    expect(retain("DeliveryDelay")).toBe(true);
    expect(retain("Rendering Failure")).toBe(true);
    expect(retain("Delivery")).toBe(false);
    expect(retain("Open")).toBe(false);
  });

  it("rejects an envelope that isn't an SES notification", () => {
    expect(() => sesAdapter.validateEnvelope(body({ Type: "Notification" }))).toThrow();
    expect(() => sesAdapter.validateEnvelope(Buffer.from("not json"))).toThrow();
    expect(() =>
      sesAdapter.validateEnvelope(body(snsNotification(bounceEvent))),
    ).not.toThrow();
  });
});
