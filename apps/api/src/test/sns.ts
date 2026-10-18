import crypto from "node:crypto";
import {
    buildSigningString,
    type SnsMessage,
} from "../delivery-feedback/adapters/sns";

/**
 * Locally signed stand-ins for Amazon SNS messages. Tests serve
 * `TEST_SNS_PUBLIC_KEY_PEM` as the "certificate" (Node accepts a bare public
 * key wherever it accepts an X.509 certificate), so the real verification
 * path runs end to end.
 */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
});

export const TEST_SNS_PUBLIC_KEY_PEM = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
export const TEST_SNS_CERT_URL =
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
export const TEST_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:ses-feedback";

export function signSnsMessage(
    message: SnsMessage,
    version: "1" | "2" = "2",
): SnsMessage {
    const signed = { ...message, SignatureVersion: version };
    const signature = crypto
        .createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256")
        .update(buildSigningString(signed)!, "utf8")
        .sign(privateKey, "base64");
    return { ...signed, Signature: signature };
}

/** An unsigned SNS `Notification` envelope around an SES event. */
export function snsNotification(
    sesEvent: Record<string, unknown>,
    overrides: SnsMessage = {},
): SnsMessage {
    return {
        Type: "Notification",
        MessageId: "sns-msg-1",
        TopicArn: TEST_TOPIC_ARN,
        Message: JSON.stringify(sesEvent),
        Timestamp: "2026-10-14T10:00:00.000Z",
        SigningCertURL: TEST_SNS_CERT_URL,
        ...overrides,
    };
}
