import { beforeEach, describe, expect, it, mock } from "bun:test";

const sdk = await import("@aws-sdk/client-sesv2");
let handle: (command: unknown) => unknown;
let sent: unknown[];
mock.module("@aws-sdk/client-sesv2", () => ({
  ...sdk,
  SESv2Client: class {
    async send(command: unknown) {
      sent.push(command);
      return handle(command);
    }
  },
}));

const { sesAdapter } = await import("./domain-providers");
const {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  NotFoundException,
} = sdk;

const credentials = { accessKeyId: "AKIA-TEST", secretAccessKey: "secret" };
const meta = { $metadata: {} };

beforeEach(() => {
  sent = [];
});

describe("SES domain adapter", () => {
  it("registers a domain with Easy DKIM and returns its CNAMEs", async () => {
    handle = () => ({
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: "PENDING", Tokens: ["t1", "t2", "t3"] },
    });
    const state = await sesAdapter(credentials, "").register("school.example.org");

    expect(sent[0]).toBeInstanceOf(CreateEmailIdentityCommand);
    expect(
      (sent[0] as InstanceType<typeof CreateEmailIdentityCommand>).input,
    ).toMatchObject({
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

  it("never adopts an identity that already exists at the provider", async () => {
    handle = () => {
      throw new AlreadyExistsException({ message: "exists", ...meta });
    };

    await expect(
      sesAdapter(credentials, "").register("school.example.org"),
    ).rejects.toThrow("domain_exists_at_provider");
    // No lookup of, and so no later claim on, the existing identity.
    expect(sent).toHaveLength(1);
  });

  it("treats a missing identity as none, and removing it as done", async () => {
    handle = () => {
      throw new NotFoundException({ message: "missing", ...meta });
    };
    const adapter = sesAdapter(credentials, "");

    expect(await adapter.status("school.example.org")).toBeNull();
    await adapter.remove("school.example.org");
    expect(sent[1]).toBeInstanceOf(DeleteEmailIdentityCommand);
  });
});
