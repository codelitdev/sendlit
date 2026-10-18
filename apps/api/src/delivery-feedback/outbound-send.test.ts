import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { espConfigs, outboundMessages } from "../db/schema";
import { seedTeamAndContact, type TestDb, truncateAll } from "../test/db";
import {
  createPinnedOutboundMessage,
  extractProviderMessageId,
  withCorrelationHeaders,
} from "./outbound-send";

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  await truncateAll(tdb);
});

describe("outbound submission idempotency", () => {
  it("reuses the ledger row and RFC Message-ID across a campaign retry", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const input = {
      teamId: team.id,
      deliverySourceType: "team" as const,
      espConfigId: esp.id,
      espGrantId: null,
      provider: esp.provider,
      sourceType: "campaign" as const,
      submissionKey: "campaign:ongoing-1:email-1",
      recipientEmail: "reader@example.com",
      normalizedRecipient: "reader@example.com",
    };

    const first = await createPinnedOutboundMessage(input);
    const retry = await createPinnedOutboundMessage(input);

    expect(retry.outbound.id).toBe(first.outbound.id);
    expect(retry.rfcMessageId).toBe(first.rfcMessageId);
    expect(
      await tdb
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.submissionKey, input.submissionKey)),
    ).toHaveLength(1);
  });

  it("does not share ledger rows between distinct submissions", async () => {
    const { team } = await seedTeamAndContact(tdb);
    const [esp] = await tdb
      .select()
      .from(espConfigs)
      .where(eq(espConfigs.teamId, team.id));
    const base = {
      teamId: team.id,
      deliverySourceType: "team" as const,
      espConfigId: esp.id,
      espGrantId: null,
      provider: esp.provider,
      sourceType: "campaign" as const,
      recipientEmail: "reader@example.com",
      normalizedRecipient: "reader@example.com",
    };

    const first = await createPinnedOutboundMessage({
      ...base,
      submissionKey: "campaign:ongoing-1:email-1",
    });
    const second = await createPinnedOutboundMessage({
      ...base,
      submissionKey: "campaign:ongoing-1:email-2",
    });

    expect(second.outbound.id).not.toBe(first.outbound.id);
    expect(second.rfcMessageId).not.toBe(first.rfcMessageId);
  });
});

describe("SES send-time correlation", () => {
  it("extracts the SES message id from the SMTP reply", () => {
    expect(extractProviderMessageId("ses", "250 Ok 0100018f-abc-000000")).toBe(
      "0100018f-abc-000000",
    );
    // Other providers (and unexpected replies) keep the raw line.
    expect(extractProviderMessageId("postmark", "250 Ok abc")).toBe("250 Ok abc");
    expect(extractProviderMessageId("ses", "250 queued")).toBe("250 queued");
    expect(extractProviderMessageId("ses", null)).toBeNull();
  });

  it("tags SES sends with the outbound message id, keeping caller tags", () => {
    const outbound = { provider: "ses", messageId: "msg_abc" };
    expect(withCorrelationHeaders(outbound)).toEqual({
      "X-SES-MESSAGE-TAGS": "sendlit_message_id=msg_abc",
    });
    expect(
      withCorrelationHeaders(outbound, {
        "x-ses-message-tags": "campaign=fall",
        "List-Unsubscribe": "<https://x>",
      }),
    ).toEqual({
      "x-ses-message-tags": "campaign=fall, sendlit_message_id=msg_abc",
      "List-Unsubscribe": "<https://x>",
    });
  });

  it("leaves other providers' headers untouched", () => {
    const headers = { "List-Unsubscribe": "<https://x>" };
    expect(
      withCorrelationHeaders({ provider: "postmark", messageId: "msg_abc" }, headers),
    ).toBe(headers);
    expect(withCorrelationHeaders(null, headers)).toBe(headers);
  });
});
