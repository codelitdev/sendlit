import { describe, expect, it, vi } from "bun:test";
import {
  TEST_SNS_CERT_URL as CERT_URL,
  TEST_SNS_PUBLIC_KEY_PEM as PUBLIC_KEY_PEM,
  signSnsMessage,
  snsNotification,
  TEST_TOPIC_ARN as TOPIC_ARN,
} from "../../test/sns";
import {
  buildSigningString,
  createSnsVerifier,
  isValidSigningCertUrl,
  isValidSubscribeUrl,
  type SnsMessage,
} from "./sns";

function notification(overrides: SnsMessage = {}): SnsMessage {
  return snsNotification({ eventType: "Bounce" }, overrides);
}

describe("isValidSigningCertUrl", () => {
  it("accepts an exact regional SNS certificate URL", () => {
    expect(isValidSigningCertUrl(CERT_URL)).toBe(true);
    expect(
      isValidSigningCertUrl(
        "https://sns.us-gov-west-1.amazonaws.com/SimpleNotificationService-1.pem",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "plain http",
      "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-a.pem",
    ],
    [
      "an S3 bucket host",
      "https://sns.s3.amazonaws.com/SimpleNotificationService-a.pem",
    ],
    [
      "a lookalike suffix",
      "https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-a.pem",
    ],
    [
      "a non-SNS AWS host",
      "https://s3.us-east-1.amazonaws.com/SimpleNotificationService-a.pem",
    ],
    ["an IP literal", "https://169.254.169.254/SimpleNotificationService-a.pem"],
    [
      "an explicit port",
      "https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-a.pem",
    ],
    [
      "credentials",
      "https://user:pass@sns.us-east-1.amazonaws.com/SimpleNotificationService-a.pem",
    ],
    ["a query string", `${CERT_URL}?x=1`],
    ["a hash", `${CERT_URL}#x`],
    ["the wrong path", "https://sns.us-east-1.amazonaws.com/other.pem"],
    [
      "a nested path",
      "https://sns.us-east-1.amazonaws.com/a/SimpleNotificationService-a.pem",
    ],
    ["a non-string", 42],
  ])("rejects %s", (_label, url) => {
    expect(isValidSigningCertUrl(url)).toBe(false);
  });
});

describe("isValidSubscribeUrl", () => {
  const valid = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC_ARN)}&Token=abc`;

  it("accepts a ConfirmSubscription call for the message's topic", () => {
    expect(isValidSubscribeUrl(valid, TOPIC_ARN)).toBe(true);
  });

  it("rejects an off-Amazon host, another action, or another topic", () => {
    expect(
      isValidSubscribeUrl(
        valid.replace("sns.us-east-1.amazonaws.com", "evil.test"),
        TOPIC_ARN,
      ),
    ).toBe(false);
    expect(
      isValidSubscribeUrl(
        valid.replace("ConfirmSubscription", "Unsubscribe"),
        TOPIC_ARN,
      ),
    ).toBe(false);
    expect(isValidSubscribeUrl(valid, "arn:aws:sns:us-east-1:123456789012:other")).toBe(
      false,
    );
  });
});

describe("buildSigningString", () => {
  it("signs Notification keys in byte order and skips an absent Subject", () => {
    expect(buildSigningString(notification())).toBe(
      [
        "Message",
        JSON.stringify({ eventType: "Bounce" }),
        "MessageId",
        "sns-msg-1",
        "Timestamp",
        "2026-10-14T10:00:00.000Z",
        "TopicArn",
        TOPIC_ARN,
        "Type",
        "Notification",
        "",
      ].join("\n"),
    );
    expect(buildSigningString(notification({ Subject: "Hi" }))).toContain(
      "Subject\nHi\n",
    );
  });

  it("includes SubscribeURL and Token for subscription messages", () => {
    const signing = buildSigningString({
      Type: "SubscriptionConfirmation",
      Message: "m",
      MessageId: "id",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?x",
      Timestamp: "t",
      Token: "tok",
      TopicArn: TOPIC_ARN,
    });
    expect(signing).toContain("SubscribeURL\n");
    expect(signing).toContain("Token\ntok\n");
  });

  it("returns null for an unknown type or a missing required key", () => {
    expect(buildSigningString(notification({ Type: "Other" }))).toBeNull();
    const { MessageId: _omit, ...missing } = notification();
    expect(buildSigningString(missing)).toBeNull();
  });
});

describe("createSnsVerifier", () => {
  function verifier(fetchCertificate = vi.fn(async () => PUBLIC_KEY_PEM)) {
    return {
      verify: createSnsVerifier({ fetchCertificate }),
      fetchCertificate,
    };
  }

  it("accepts signature versions 1 and 2", async () => {
    const { verify } = verifier();
    expect(await verify(signSnsMessage(notification(), "1"))).toBe("valid");
    expect(await verify(signSnsMessage(notification(), "2"))).toBe("valid");
  });

  it.each(["Message", "MessageId", "Timestamp", "TopicArn"])(
    "rejects a message whose signed %s was tampered with",
    async (key) => {
      const { verify } = verifier();
      const signed = signSnsMessage(notification());
      expect(await verify({ ...signed, [key]: "tampered" })).toBe("invalid");
    },
  );

  it("rejects an unsupported signature version without fetching", async () => {
    const { verify, fetchCertificate } = verifier();
    const signed = signSnsMessage(notification());
    expect(await verify({ ...signed, SignatureVersion: "3" })).toBe("invalid");
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it("never fetches a certificate from a non-SNS URL", async () => {
    const { verify, fetchCertificate } = verifier();
    const signed = signSnsMessage(
      notification({
        SigningCertURL: "https://sns.s3.amazonaws.com/SimpleNotificationService-a.pem",
      }),
    );
    expect(await verify(signed)).toBe("invalid");
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it("caches the certificate per URL", async () => {
    const { verify, fetchCertificate } = verifier();
    await verify(signSnsMessage(notification()));
    await verify(signSnsMessage(notification({ MessageId: "sns-msg-2" })));
    expect(fetchCertificate).toHaveBeenCalledTimes(1);
  });

  it("reports a failed fetch as unavailable and retries it next time", async () => {
    const fetchCertificate = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(PUBLIC_KEY_PEM);
    const { verify } = verifier(fetchCertificate);
    const signed = signSnsMessage(notification());
    expect(await verify(signed)).toBe("unavailable");
    expect(await verify(signed)).toBe("valid");
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
  });

  it("treats a non-PEM certificate response as unavailable", async () => {
    const { verify } = verifier(vi.fn(async () => "<html>nope</html>"));
    expect(await verify(signSnsMessage(notification()))).toBe("unavailable");
  });
});
