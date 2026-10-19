import crypto from "node:crypto";

/**
 * Amazon SNS HTTPS-subscription message verification, per AWS's "Verifying
 * the signatures of Amazon SNS messages" spec. SNS signs every message with
 * its own key — there is no shared secret — so authenticity rests on
 * fetching the signing certificate from a URL carried in the (untrusted)
 * body. Both that URL and any `SubscribeURL` are therefore pinned to exact
 * Amazon SNS hosts before any network call is made.
 */

// Exactly `sns.<region>.amazonaws.com`. A looser `sns\..*amazonaws\.com`
// would also accept S3 bucket hosts such as `sns.s3.amazonaws.com`, whose
// content anyone can publish.
const SNS_HOST = /^sns\.[a-z]{2}(?:-[a-z]+)+-\d+\.amazonaws\.com$/;
const SIGNING_CERT_PATH = /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/;

const SIGNATURE_ALGORITHMS: Record<string, string> = {
  "1": "RSA-SHA1",
  "2": "RSA-SHA256",
};

const SUBSCRIPTION_SIGNED_KEYS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
];

/** The canonical, byte-ordered keys AWS signs for each message type.
 * `Subject` is included only when the notification carries one. */
const SIGNED_KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: SUBSCRIPTION_SIGNED_KEYS,
  UnsubscribeConfirmation: SUBSCRIPTION_SIGNED_KEYS,
};
const OPTIONAL_SIGNED_KEYS = new Set(["Subject"]);

const MAX_CACHED_CERTIFICATES = 20;
const MAX_CERTIFICATE_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

export type SnsMessage = Record<string, unknown>;

export type SnsVerifyResult =
  /** Signature checks out against an Amazon SNS certificate. */
  | "valid"
  /** Malformed, unsigned, off-Amazon cert URL, or a bad signature. */
  | "invalid"
  /** The signing certificate couldn't be fetched — the caller should
   * answer 5xx so SNS retries rather than drop the message. */
  | "unavailable";

function parseSnsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const ok =
    url.protocol === "https:" &&
    SNS_HOST.test(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password;
  return ok ? url : null;
}

export function isValidSigningCertUrl(value: unknown): boolean {
  const url = parseSnsUrl(value);
  return Boolean(
    url && SIGNING_CERT_PATH.test(url.pathname) && !url.search && !url.hash,
  );
}

/** A `SubscribeURL` must be an Amazon SNS `ConfirmSubscription` call for the
 * topic the message itself names (already matched against the connection). */
export function isValidSubscribeUrl(value: unknown, topicArn: string): boolean {
  const url = parseSnsUrl(value);
  return Boolean(
    url &&
      !url.hash &&
      url.searchParams.get("Action") === "ConfirmSubscription" &&
      url.searchParams.get("TopicArn") === topicArn,
  );
}

export function buildSigningString(message: SnsMessage): string | null {
  const keys = SIGNED_KEYS[String(message.Type)];
  if (!keys) return null;

  let signingString = "";
  for (const key of keys) {
    const value = Object.hasOwn(message, key) ? message[key] : undefined;
    if (value == null && OPTIONAL_SIGNED_KEYS.has(key)) continue;
    if (typeof value !== "string") return null;
    signingString += `${key}\n${value}\n`;
  }
  return signingString;
}

/** GETs an already-validated Amazon SNS URL: no redirects, short timeout. */
export async function fetchSnsUrl(url: string): Promise<Response> {
  return fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function fetchSigningCertificate(url: string): Promise<string> {
  const response = await fetchSnsUrl(url);
  if (!response.ok) {
    throw new Error(`certificate request failed with ${response.status}`);
  }
  const pem = await response.text();
  if (pem.length > MAX_CERTIFICATE_BYTES) {
    throw new Error("certificate too large");
  }
  return pem;
}

export function createSnsVerifier({
  fetchCertificate = fetchSigningCertificate,
}: {
  fetchCertificate?: (url: string) => Promise<string>;
} = {}) {
  // URL → parsed key. Amazon rotates signing certs rarely, so steady-state
  // verification does no network I/O. A failed fetch is evicted so the
  // next SNS retry tries again.
  const cache = new Map<string, Promise<crypto.KeyObject>>();

  function getPublicKey(url: string): Promise<crypto.KeyObject> {
    let pending = cache.get(url);
    if (!pending) {
      if (cache.size >= MAX_CACHED_CERTIFICATES) {
        cache.delete(cache.keys().next().value!);
      }
      pending = fetchCertificate(url).then((pem) => crypto.createPublicKey(pem));
      cache.set(url, pending);
      pending.catch(() => cache.delete(url));
    }
    return pending;
  }

  return async function verifySnsMessage(
    message: SnsMessage,
  ): Promise<SnsVerifyResult> {
    const algorithm = SIGNATURE_ALGORITHMS[String(message.SignatureVersion)];
    const signingString = buildSigningString(message);
    if (
      !algorithm ||
      !signingString ||
      typeof message.Signature !== "string" ||
      !isValidSigningCertUrl(message.SigningCertURL)
    ) {
      return "invalid";
    }

    let publicKey: crypto.KeyObject;
    try {
      publicKey = await getPublicKey(message.SigningCertURL as string);
    } catch {
      return "unavailable";
    }

    try {
      const valid = crypto
        .createVerify(algorithm)
        .update(signingString, "utf8")
        .verify(publicKey, message.Signature, "base64");
      return valid ? "valid" : "invalid";
    } catch {
      return "invalid";
    }
  };
}
