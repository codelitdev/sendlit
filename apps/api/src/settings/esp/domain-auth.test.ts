import { describe, expect, it } from "bun:test";
import { checkDomainAuthentication, sendingDomainOf } from "./domain-auth";

const KEY = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDD";

function dns(
  txt: Record<string, string[]>,
  extra: { mx?: Record<string, string>; cname?: Record<string, string> } = {},
) {
  return {
    resolveTxt: async (name: string) => {
      if (!txt[name])
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return txt[name].map((value) => [value]);
    },
    resolveMx: async (name: string) =>
      extra.mx?.[name] ? [{ exchange: extra.mx[name], priority: 10 }] : [],
    resolveCname: async (name: string) =>
      extra.cname?.[name] ? [extra.cname[name]] : [],
  };
}

const esp = (provider: string, fromEmail: string | null = "news@example.com") => ({
  provider,
  host: "email-smtp.eu-west-1.amazonaws.com",
  fromEmail,
});

describe("checkDomainAuthentication", () => {
  it("reads the sending domain from the From address", async () => {
    expect(sendingDomainOf("x@Mail.Example.com.")).toBe("mail.example.com");
    expect(sendingDomainOf(null)).toBeNull();
    expect(await checkDomainAuthentication(esp("ses", null), dns({}))).toBeNull();
  });

  it("fails every check for a domain with no records and lists what to add", async () => {
    const result = await checkDomainAuthentication(esp("sendgrid"), dns({}));
    expect(result).toMatchObject({
      domain: "example.com",
      spf: { status: "fail", host: "example.com", record: null },
      dkim: { status: "fail", selector: null },
      dmarc: { status: "fail", policy: null },
      providerConsoleUrl: "https://app.sendgrid.com/settings/sender_auth",
    });
    expect(result?.records).toContainEqual({
      type: "TXT",
      name: "example.com",
      value: "v=spf1 include:sendgrid.net ~all",
      purpose: "SPF",
      present: false,
    });
    expect(result?.records).toContainEqual({
      type: "TXT",
      name: "_dmarc.example.com",
      value: "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com",
      purpose: "DMARC",
      present: false,
    });
  });

  it("passes a fully set up Resend domain, checking SPF on the bounce subdomain", async () => {
    const result = await checkDomainAuthentication(
      esp("resend"),
      dns(
        {
          "send.example.com": ["v=spf1 include:amazonses.com ~all"],
          "resend._domainkey.example.com": [KEY],
          "_dmarc.example.com": ["v=DMARC1; p=quarantine; rua=mailto:d@example.com"],
        },
        { mx: { "send.example.com": "feedback-smtp.eu-west-1.amazonses.com" } },
      ),
    );
    expect(result).toMatchObject({
      spf: { status: "pass", host: "send.example.com" },
      dkim: { status: "pass", selector: "resend" },
      dmarc: { status: "pass", policy: "quarantine" },
    });
    expect(result?.records.every((record) => record.present)).toBe(true);
    expect(result?.records[0]).toMatchObject({
      type: "MX",
      name: "send.example.com",
      value: "10 feedback-smtp.eu-west-1.amazonses.com",
    });
  });

  it("warns when SPF misses the provider and suggests the merged record", async () => {
    const result = await checkDomainAuthentication(
      esp("mailgun"),
      dns({
        "example.com": [
          "v=spf1 include:_spf.google.com ~all",
          "google-site-verification=x",
        ],
      }),
    );
    expect(result?.spf).toMatchObject({ status: "warn" });
    expect(result?.records.find((record) => record.purpose === "SPF")?.value).toBe(
      "v=spf1 include:mailgun.org include:_spf.google.com ~all",
    );
  });

  it("fails when the domain has two SPF records", async () => {
    const result = await checkDomainAuthentication(
      esp("smtp"),
      dns({ "example.com": ["v=spf1 a ~all", "v=spf1 mx ~all"] }),
    );
    expect(result?.spf.status).toBe("fail");
    expect(result?.spf.message).toContain("2 SPF records");
  });

  it("checks a custom DKIM selector and the parent domain's DMARC", async () => {
    const result = await checkDomainAuthentication(
      esp("smtp", "a@news.example.com"),
      dns({
        "news.example.com": ["v=spf1 a ~all"],
        "custom1._domainkey.news.example.com": [`v=DKIM1; k=rsa; ${KEY}`],
        "_dmarc.example.com": ["v=DMARC1; p=none"],
      }),
    );
    expect(result?.dkim.status).toBe("fail");
    const withSelector = await checkDomainAuthentication(
      esp("smtp", "a@news.example.com"),
      {
        ...dns({
          "news.example.com": ["v=spf1 a ~all"],
          "custom1._domainkey.news.example.com": [`v=DKIM1; k=rsa; ${KEY}`],
          "_dmarc.example.com": ["v=DMARC1; p=none"],
        }),
        dkimSelector: "custom1",
      },
    );
    expect(withSelector).toMatchObject({
      spf: { status: "pass" },
      dkim: { status: "pass", selector: "custom1" },
      dmarc: { status: "pass", policy: "none" },
    });
    expect(withSelector?.dmarc.message).toContain("monitoring only");
  });

  it("does not count a revoked (empty) DKIM key", async () => {
    const result = await checkDomainAuthentication(
      esp("resend"),
      dns({ "resend._domainkey.example.com": ["v=DKIM1; p="] }),
    );
    expect(result?.dkim.status).toBe("fail");
  });

  it("passes SES DKIM on the token's CNAME even when that token's key is empty", async () => {
    const token = "6p3ranxrt5vvjzleljadgpakhkvklt2d";
    const result = await checkDomainAuthentication(esp("ses"), {
      ...dns(
        { [`${token}._domainkey.example.com`]: [""] },
        {
          cname: {
            [`${token}._domainkey.example.com`]: `${token}.dkim.amazonses.com.`,
          },
        },
      ),
      dkimSelector: token,
    });
    expect(result?.dkim).toMatchObject({ status: "pass", selector: token });
    const dkimRows = (result?.records ?? []).filter((record) =>
      record.purpose.startsWith("DKIM"),
    );
    expect(dkimRows.length).toBe(3);
    expect(dkimRows.every((row) => row.present)).toBe(true);
  });

  it("doesn't pass SES DKIM when the token's CNAME points somewhere else", async () => {
    const token = "abc123";
    const result = await checkDomainAuthentication(esp("ses"), {
      ...dns(
        {},
        { cname: { [`${token}._domainkey.example.com`]: "elsewhere.example.net" } },
      ),
      dkimSelector: token,
    });
    expect(result?.dkim.status).toBe("fail");
  });
});
