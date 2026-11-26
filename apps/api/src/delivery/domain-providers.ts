import {
  AlreadyExistsException,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  NotFoundException,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import { sesRegionOf } from "../settings/esp/domain-auth";
import { decryptSecret, encryptSecret } from "../utils/secret-crypto";

/**
 * Registers teams' own From domains with the organization's ESP through its
 * management API (#220). SES first; other providers plug in here. Plain
 * SMTP has no such API, so it stays a manual setup.
 */

export type DomainDnsRecord = {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: "dkim" | "dmarc";
};

export type ProviderDomainState = {
  /** The provider will send as this domain. */
  verified: boolean;
  dkim: "pending" | "verified" | "failed";
  /** Records the provider needs published. DMARC is added by the caller. */
  records: DomainDnsRecord[];
};

export interface DomainProviderAdapter {
  readonly provider: string;
  /** Registers a new domain. Throws `domain_exists_at_provider` when the
   * provider already has it: SendLit never adopts, and so never later
   * deletes, an identity it did not create. */
  register(domain: string): Promise<ProviderDomainState>;
  status(domain: string): Promise<ProviderDomainState | null>;
  remove(domain: string): Promise<void>;
}

export type SesManagementCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
};

export function encryptManagementCredentials(
  credentials: SesManagementCredentials,
): string {
  return encryptSecret(JSON.stringify(credentials));
}

function sesDkim(status: string | undefined): ProviderDomainState["dkim"] {
  if (status === "SUCCESS") return "verified";
  if (status === "FAILED") return "failed";
  // PENDING, NOT_STARTED, TEMPORARY_FAILURE: still waiting on DNS.
  return "pending";
}

function sesState(
  domain: string,
  identity: {
    VerifiedForSendingStatus?: boolean;
    DkimAttributes?: { Status?: string; Tokens?: string[] };
  },
): ProviderDomainState {
  return {
    verified: identity.VerifiedForSendingStatus === true,
    dkim: sesDkim(identity.DkimAttributes?.Status),
    records: (identity.DkimAttributes?.Tokens ?? []).map((token) => ({
      type: "CNAME",
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      purpose: "dkim",
    })),
  };
}

export function sesAdapter(
  credentials: SesManagementCredentials,
  host: string,
): DomainProviderAdapter {
  const ses = new SESv2Client({
    // An SES-compatible endpoint (e.g. LocalStack) instead of AWS.
    ...(process.env.SES_API_ENDPOINT ? { endpoint: process.env.SES_API_ENDPOINT } : {}),
    region: credentials.region || sesRegionOf(host),
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
  return {
    provider: "ses",
    async status(domain) {
      try {
        const identity = await ses.send(
          new GetEmailIdentityCommand({ EmailIdentity: domain }),
        );
        return sesState(domain, identity);
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    },
    async register(domain) {
      try {
        const created = await ses.send(
          new CreateEmailIdentityCommand({
            EmailIdentity: domain,
            DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
          }),
        );
        return sesState(domain, created);
      } catch (error) {
        if (error instanceof AlreadyExistsException) {
          throw new Error("domain_exists_at_provider");
        }
        throw error;
      }
    },
    async remove(domain) {
      try {
        await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    },
  };
}

/**
 * The adapter for an organization ESP. Throws `provider_domain_unsupported`
 * when its provider has no domain API yet, and
 * `esp_management_credentials_required` when none are stored.
 */
export function domainProviderFor(esp: {
  provider: string;
  host: string;
  encryptedManagementSecret: string | null;
}): DomainProviderAdapter {
  if (esp.provider !== "ses") throw new Error("provider_domain_unsupported");
  if (!esp.encryptedManagementSecret) {
    throw new Error("esp_management_credentials_required");
  }
  const credentials = JSON.parse(
    decryptSecret(esp.encryptedManagementSecret),
  ) as SesManagementCredentials;
  return sesAdapter(credentials, esp.host);
}
