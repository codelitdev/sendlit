import { describe, expect, it } from "bun:test";
import {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
} from "@aws-sdk/client-sesv2";
import { sesAdapter } from "./domain-providers";

const credentials = { accessKeyId: "AKIA-TEST", secretAccessKey: "secret" };
const meta = { $metadata: {} };

function fakeSes(handler: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      send: async (command: unknown) => {
        sent.push(command);
        return handler(command);
      },
    } as never,
  };
}

describe("SES domain adapter", () => {
  it("registers a domain with Easy DKIM and returns its CNAMEs", async () => {
    const ses = fakeSes(() => ({
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: "PENDING", Tokens: ["t1", "t2", "t3"] },
    }));
    const state = await sesAdapter(credentials, "", ses.client).register(
      "school.example.org",
    );

    expect(ses.sent[0]).toBeInstanceOf(CreateEmailIdentityCommand);
    expect((ses.sent[0] as CreateEmailIdentityCommand).input).toMatchObject({
      EmailIdentity: "school.example.org",
      DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
    });
    expect(state).toEqual({
      verified: false,
      dkim: "pending",
      records: ["t1", "t2", "t3"].map((token) => ({
        type: "CNAME",
        name: `${token}._domainkey.school.example.org`,
        value: `${token}.dkim.amazonses.com`,
        purpose: "dkim",
      })),
    });
  });

  it("reuses an identity that already exists and maps DKIM status", async () => {
    const ses = fakeSes((command) => {
      if (command instanceof CreateEmailIdentityCommand) {
        throw new AlreadyExistsException({ message: "exists", ...meta });
      }
      return {
        VerifiedForSendingStatus: true,
        DkimAttributes: { Status: "SUCCESS", Tokens: ["t1"] },
      };
    });
    const state = await sesAdapter(credentials, "", ses.client).register(
      "school.example.org",
    );

    expect(ses.sent[1]).toBeInstanceOf(GetEmailIdentityCommand);
    expect(state).toMatchObject({ verified: true, dkim: "verified" });
  });

  it("treats a missing identity as none, and removing it as done", async () => {
    const ses = fakeSes(() => {
      throw new NotFoundException({ message: "missing", ...meta });
    });
    const adapter = sesAdapter(credentials, "", ses.client);

    expect(await adapter.status("school.example.org")).toBeNull();
    await adapter.remove("school.example.org");
    expect(ses.sent[1]).toBeInstanceOf(DeleteEmailIdentityCommand);
  });
});
