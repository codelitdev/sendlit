import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

import { db } from "../db/client";
import { espConfigs, espWebhookReceipts } from "../db/schema";
import { seedTeamAndContact, type TestDb, truncateAll } from "../test/db";
import {
  decryptFeedbackCredentials,
  disableFeedbackConnection,
  feedbackConnectionReadinessError,
  getActiveFeedbackConnectionForEspConfig,
  getFeedbackConnectionByConnectionId,
  recordFeedbackControlOutcome,
  retireActiveFeedbackConnection,
  upsertFeedbackConnection,
} from "./feedback-connection-queries";
import { feedbackConnectionInputError } from "./feedback-connection-shape";
import {
  claimReceiptForProcessing,
  createWebhookReceipt,
  decryptReceiptPayload,
  findDuplicateReceipt,
  getReceiptsDueForProcessing,
  hashBody,
  markReceiptDeadLetter,
  markReceiptFailedForRetry,
  markReceiptProcessed,
  sanitizeHeaders,
} from "./webhook-receipt-queries";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("feedback connection + webhook receipts (integration)", () => {
  it("creates, rotates credentials with grace, and retires on provider change", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));

    const created = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "secret-v1",
    });
    expect(created.status).toBe("pending");
    expect(created.connectionId).toMatch(/^whc_/);

    const rotated = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "secret-v2",
    });
    expect(rotated.id).toBe(created.id);
    expect(rotated.connectionId).toBe(created.connectionId);

    const creds = decryptFeedbackCredentials(rotated);
    expect(creds).toEqual({
      credential: "secret-v2",
      previousCredential: "secret-v1",
    });

    expect((await getActiveFeedbackConnectionForEspConfig(esp.id))?.id).toBe(
      created.id,
    );

    await retireActiveFeedbackConnection(esp.id);
    expect(await getActiveFeedbackConnectionForEspConfig(esp.id)).toBeNull();

    // Public webhook lookup still resolves retiring connections.
    const byPublicId = await getFeedbackConnectionByConnectionId(
      created.connectionId,
      "postmark",
    );
    expect(byPublicId?.status).toBe("retiring");

    // Fresh connection after retirement.
    const next = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "resend",
      credential: "resend-secret",
    });
    expect(next.connectionId).not.toBe(created.connectionId);

    await disableFeedbackConnection(team.id, esp.id);
    expect(
      await getFeedbackConnectionByConnectionId(next.connectionId, "resend"),
    ).toBeNull();
  });

  it("stores encrypted receipts, dedupes, claims, and processes them", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));

    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "hook-secret",
    });

    const rawBody = Buffer.from(
      JSON.stringify({ RecordType: "Delivery", MessageID: "1" }),
      "utf8",
    );
    const safe = sanitizeHeaders({
      "content-type": "application/json",
      authorization: "Basic abc",
      "x-sendlit-webhook-secret": "should-strip",
      "x-custom": "keep",
    });
    expect(safe).toEqual({
      "content-type": "application/json",
      "x-custom": "keep",
    });
    expect(hashBody(rawBody)).toHaveLength(64);

    const receipt = await createWebhookReceipt({
      connectionId: connection.id,
      teamId: team.id,
      provider: "postmark",
      providerRequestId: "req-1",
      rawBody,
      safeHeaders: safe,
    });
    expect(receipt.status).toBe("pending");
    expect(receipt.encryptedPayload).toBeTruthy();
    expect(decryptReceiptPayload(receipt)?.equals(rawBody)).toBe(true);

    expect((await findDuplicateReceipt(connection.id, "req-1"))?.id).toBe(receipt.id);

    // Claim is exclusive.
    expect(await claimReceiptForProcessing(receipt.id)).toBe(true);
    expect(await claimReceiptForProcessing(receipt.id)).toBe(false);

    await markReceiptProcessed(receipt.id);
    const [processed] = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.id, receipt.id));
    expect(processed.status).toBe("processed");
    expect(processed.processedAt).toBeTruthy();
  });

  it("retries with backoff and dead-letters exhausted receipts", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "postmark",
      credential: "hook-secret",
    });

    const receipt = await createWebhookReceipt({
      connectionId: connection.id,
      teamId: team.id,
      provider: "postmark",
      providerRequestId: "req-retry",
      rawBody: Buffer.from("{}"),
      safeHeaders: {},
    });

    await claimReceiptForProcessing(receipt.id);
    await markReceiptFailedForRetry(receipt.id, "normalize_error");

    const [retried] = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.id, receipt.id));
    expect(retried.status).toBe("pending");
    expect(retried.processingAttempts).toBe(1);
    expect(retried.nextAttemptAt).toBeTruthy();
    expect(retried.lastErrorCode).toBe("normalize_error");

    // Not due yet because nextAttemptAt is in the future.
    const due = await getReceiptsDueForProcessing();
    expect(due.find((r) => r.id === receipt.id)).toBeUndefined();

    // Force next attempt into the past.
    await tdb
      .update(espWebhookReceipts)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(espWebhookReceipts.id, receipt.id));
    expect((await getReceiptsDueForProcessing()).some((r) => r.id === receipt.id)).toBe(
      true,
    );

    await markReceiptDeadLetter(receipt.id, "unsupported_payload");
    const [dead] = await tdb
      .select()
      .from(espWebhookReceipts)
      .where(eq(espWebhookReceipts.id, receipt.id));
    expect(dead.status).toBe("dead_letter");
    expect(dead.lastErrorCode).toBe("unsupported_payload");
  });
});

describe("SES feedback connections", () => {
  const topicArn = "arn:aws:sns:us-east-1:123456789012:ses-feedback";

  it("requires a valid topic ARN for SES and a credential for others", () => {
    expect(
      feedbackConnectionInputError("ses", { expectedTopicArn: topicArn }),
    ).toBeNull();
    expect(feedbackConnectionInputError("ses", { credential: "x" })).toBe(
      "feedback_topic_arn_required",
    );
    expect(
      feedbackConnectionInputError("ses", {
        expectedTopicArn: "arn:aws:sqs:us-east-1:123456789012:queue",
      }),
    ).toBe("feedback_topic_arn_invalid");
    expect(
      feedbackConnectionInputError("ses", {
        expectedTopicArn: "arn:aws-us-gov:sns:us-gov-west-1:123456789012:t",
      }),
    ).toBeNull();
    expect(
      feedbackConnectionInputError("postmark", {
        expectedTopicArn: topicArn,
      }),
    ).toBe("feedback_credential_required");
    expect(feedbackConnectionInputError("postmark", { credential: "x" })).toBeNull();
  });

  it("is ready only once SNS confirms, and a new topic needs re-confirming", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const created = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "ses",
      expectedTopicArn: topicArn,
    });
    expect(created.encryptedCredentials).toBeNull();
    expect(feedbackConnectionReadinessError(created)).toBe(
      "feedback_subscription_unconfirmed",
    );

    await recordFeedbackControlOutcome(created.id, "subscription_confirmed");
    const confirmed = await getFeedbackConnectionByConnectionId(
      created.connectionId,
      "ses",
    );
    expect(feedbackConnectionReadinessError(confirmed!)).toBeNull();

    // Re-saving the same topic keeps the confirmation...
    const same = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "ses",
      expectedTopicArn: topicArn,
    });
    expect(same.subscriptionConfirmedAt).toBeTruthy();
    // ...a different topic clears it.
    const moved = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "ses",
      expectedTopicArn: `${topicArn}-2`,
    });
    expect(moved.connectionId).toBe(created.connectionId);
    expect(moved.subscriptionConfirmedAt).toBeNull();
  });

  it("flags an unsubscribed connection", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const connection = await upsertFeedbackConnection({
      teamId: team.id,
      espConfigId: esp.id,
      provider: "ses",
      expectedTopicArn: topicArn,
    });
    await recordFeedbackControlOutcome(connection.id, "subscription_confirmed");
    await recordFeedbackControlOutcome(connection.id, "unsubscribed");
    const row = await getFeedbackConnectionByConnectionId(
      connection.connectionId,
      "ses",
    );
    expect(row).toMatchObject({
      status: "error",
      lastErrorCode: "sns_unsubscribed",
      subscriptionConfirmedAt: null,
    });
  });
});
