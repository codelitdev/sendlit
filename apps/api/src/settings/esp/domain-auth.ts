import type { DomainAuthentication } from "@sendlit/api-contract";
import { freshDnsLookups } from "../../utils/dns";
import type { EspConfig, EspProvider } from "./queries";

type DnsRecord = DomainAuthentication["records"][number];
type ResolveTxt = (name: string) => Promise<string[][]>;
type ResolveMx = (name: string) => Promise<{ exchange: string; priority: number }[]>;
type ResolveCname = (name: string) => Promise<string[]>;

type ProviderGuide = {
  /** SPF `include:` the provider's servers need. */
  spfInclude: string | null;
  /** Subdomain used as the bounce (MAIL FROM / Return-Path) domain, whose SPF
   * record is the one that counts for alignment. */
  returnPath: ((domain: string, region: string) => DnsRecord[]) | null;
  /** A provider that publishes SPF for its own bounce domain once its DKIM
   * CNAMEs are in place (SendGrid's automated security: the `em<id>` CNAME
   * carries SPF). The selector to look at and the suffix its CNAME points to. */
  managedSpf?: { selector: string; cnameSuffix: string };
  /** DKIM selectors the provider uses, when they are fixed. */
  dkimSelectors: string[];
  dkimRecords: (domain: string) => DnsRecord[];
  /** Where a DKIM selector's CNAME must point, for providers that host the
   * keys themselves. SES rotates keys across its three tokens, so a token's
   * key can be empty while its CNAME is correct; the CNAME is what counts. */
  dkimCnameTarget?: (selector: string) => string;
  consoleUrl: string | null;
};

const fromConsole = (
  domain: string,
  type: DnsRecord["type"],
  name: string,
  purpose: string,
): DnsRecord => ({
  type,
  name: `${name}.${domain}`,
  value: null,
  purpose,
  present: false,
});

const sesReturnPath =
  (subdomain: string) =>
  (domain: string, region: string): DnsRecord[] => [
    {
      type: "MX",
      name: `${subdomain}.${domain}`,
      value: `10 feedback-smtp.${region}.amazonses.com`,
      purpose: "Bounce (MAIL FROM) domain",
      present: false,
    },
    {
      type: "TXT",
      name: `${subdomain}.${domain}`,
      value: "v=spf1 include:amazonses.com ~all",
      purpose: "SPF for the bounce domain",
      present: false,
    },
  ];

/** What each provider asks for when you add a sending domain. Values that
 * are unique to an account (DKIM keys, SES tokens) only exist in the
 * provider's console, so those records are listed without a value. */
const GUIDES: Record<EspProvider, ProviderGuide> = {
  ses: {
    spfInclude: "amazonses.com",
    returnPath: sesReturnPath("mail"),
    dkimSelectors: [],
    dkimRecords: (domain) =>
      [1, 2, 3].map((n) =>
        fromConsole(domain, "CNAME", `<token${n}>._domainkey`, "DKIM (Easy DKIM)"),
      ),
    dkimCnameTarget: (selector) => `${selector}.dkim.amazonses.com`,
    consoleUrl: "https://console.aws.amazon.com/ses/home#/identities",
  },
  resend: {
    spfInclude: "amazonses.com",
    returnPath: sesReturnPath("send"),
    dkimSelectors: ["resend"],
    dkimRecords: (domain) => [fromConsole(domain, "TXT", "resend._domainkey", "DKIM")],
    consoleUrl: "https://resend.com/domains",
  },
  postmark: {
    spfInclude: "spf.mtasv.net",
    returnPath: (domain) => [
      {
        type: "CNAME",
        name: `pm-bounces.${domain}`,
        value: "pm.mtasv.net",
        purpose: "Bounce (Return-Path) domain",
        present: false,
      },
    ],
    dkimSelectors: [],
    dkimRecords: (domain) => [
      fromConsole(domain, "TXT", "<date>pm._domainkey", "DKIM"),
    ],
    consoleUrl: "https://account.postmarkapp.com/signature_domains",
  },
  sendgrid: {
    spfInclude: "sendgrid.net",
    returnPath: null,
    managedSpf: { selector: "s1", cnameSuffix: ".sendgrid.net" },
    dkimSelectors: ["s1", "s2"],
    dkimRecords: (domain) => [
      fromConsole(domain, "CNAME", "s1._domainkey", "DKIM"),
      fromConsole(domain, "CNAME", "s2._domainkey", "DKIM"),
      fromConsole(domain, "CNAME", "em<id>", "Bounce (Return-Path) domain"),
    ],
    consoleUrl: "https://app.sendgrid.com/settings/sender_auth",
  },
  mailgun: {
    spfInclude: "mailgun.org",
    returnPath: null,
    dkimSelectors: ["k1", "mx", "smtp", "pic", "krs", "mailo"],
    dkimRecords: (domain) => [
      fromConsole(domain, "TXT", "<selector>._domainkey", "DKIM"),
    ],
    consoleUrl: "https://app.mailgun.com/mg/sending/domains",
  },
  smtp: {
    spfInclude: null,
    returnPath: null,
    dkimSelectors: [],
    dkimRecords: (domain) => [
      fromConsole(
        domain,
        "TXT",
        "<selector>._domainkey",
        "DKIM, from your mail server",
      ),
    ],
    consoleUrl: null,
  },
};

/** Selectors common across mail services, tried when the provider's own
 * aren't found. */
const COMMON_DKIM_SELECTORS = [
  "default",
  "dkim",
  "mail",
  "selector1",
  "selector2",
  "google",
  "k1",
  "s1",
  "s2",
  "resend",
];

const SES_REGION = /email-smtp\.([a-z0-9-]+)\.amazonaws\.com/i;

export function sendingDomainOf(fromEmail: string | null): string | null {
  const domain = fromEmail?.split("@")[1]?.trim().toLowerCase().replace(/\.$/, "");
  return domain || null;
}

async function txt(resolve: ResolveTxt, name: string): Promise<string[]> {
  try {
    return (await resolve(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

const spfOf = (records: string[]) =>
  records.filter((record) => /^v=spf1(\s|$)/i.test(record.trim()));

const includes = (spf: string, include: string) =>
  spf.toLowerCase().split(/\s+/).includes(`include:${include}`);

/** The DMARC record for the domain, or for a parent domain, which also
 * covers its subdomains. */
async function findDmarc(resolve: ResolveTxt, domain: string) {
  const labels = domain.split(".");
  const hosts = labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
  // Look all of them up at once; the closest one with a record wins.
  const found = await Promise.all(
    hosts.map(async (host) => ({
      host,
      record: (await txt(resolve, `_dmarc.${host}`)).find((value) =>
        /^v=DMARC1\s*(;|$)/i.test(value.trim()),
      ),
    })),
  );
  const match = found.find((entry) => entry.record);
  return match?.record ? { host: match.host, record: match.record } : null;
}

/**
 * Checks the SPF, DKIM and DMARC records of an ESP's sending domain, as
 * Gmail and Yahoo require of bulk senders, and lists the records to add.
 */
export async function checkDomainAuthentication(
  config: Pick<EspConfig, "provider" | "host" | "fromEmail">,
  options: {
    dkimSelector?: string;
    resolveTxt?: ResolveTxt;
    resolveMx?: ResolveMx;
    resolveCname?: ResolveCname;
  } = {},
): Promise<DomainAuthentication | null> {
  const domain = sendingDomainOf(config.fromEmail);
  if (!domain) return null;
  const lookups = freshDnsLookups();
  const resolve = options.resolveTxt ?? lookups.resolveTxt;
  const resolveMx = options.resolveMx ?? lookups.resolveMx;
  const resolveCname = options.resolveCname ?? lookups.resolveCname;
  const provider = (
    config.provider in GUIDES ? config.provider : "smtp"
  ) as EspProvider;
  const guide = GUIDES[provider];
  const region = config.host.match(SES_REGION)?.[1] ?? "us-east-1";

  // SPF: the bounce domain's record when the provider uses one, else the
  // From domain's.
  const returnPath = guide.returnPath?.(domain, region) ?? [];
  const spfHost = returnPath[0]?.name ?? domain;
  const [rootTxt, returnPathTxt, managedTargets] = await Promise.all([
    txt(resolve, domain),
    spfHost === domain ? null : txt(resolve, spfHost),
    guide.managedSpf
      ? resolveCname(`${guide.managedSpf.selector}._domainkey.${domain}`).catch(
          () => [] as string[],
        )
      : Promise.resolve([] as string[]),
  ]);
  const rootSpf = spfOf(rootTxt);
  const returnPathSpf = returnPathTxt ? spfOf(returnPathTxt) : rootSpf;
  // SendGrid's automated security: with its DKIM CNAMEs in place, mail
  // bounces to em<id>.<domain>, a CNAME whose SPF SendGrid publishes, so the
  // root SPF record doesn't need to include it.
  const managedSpfTarget = managedTargets
    .map((target) => target.toLowerCase().replace(/\.$/, ""))
    .find(
      (target) => guide.managedSpf && target.endsWith(guide.managedSpf.cnameSuffix),
    );
  let spf: DomainAuthentication["spf"];
  if (rootSpf.length > 1) {
    spf = {
      status: "fail",
      host: domain,
      record: rootSpf.join(" | "),
      message: `${domain} has ${rootSpf.length} SPF records; receivers treat that as no SPF at all. Merge them into one.`,
    };
  } else if (managedSpfTarget) {
    spf = {
      status: "pass",
      host: domain,
      record: rootSpf[0] ?? null,
      message: `${provider === "sendgrid" ? "SendGrid" : "Your provider"} handles SPF through its bounce domain (automated security), so your root SPF record doesn't need to include it.`,
    };
  } else if (
    returnPathSpf[0] &&
    (!guide.spfInclude || includes(returnPathSpf[0], guide.spfInclude))
  ) {
    spf = {
      status: "pass",
      host: spfHost,
      record: returnPathSpf[0],
      message: "SPF is set up.",
    };
  } else if (returnPathSpf[0]) {
    spf = {
      status: "warn",
      host: spfHost,
      record: returnPathSpf[0],
      message: `The SPF record doesn't include ${guide.spfInclude}, so it doesn't cover your email provider.`,
    };
  } else {
    spf = {
      status: guide.returnPath ? "warn" : "fail",
      host: spfHost,
      record: null,
      message: guide.returnPath
        ? `No SPF record on ${spfHost}. Set up the custom bounce domain so SPF aligns with your From domain.`
        : `No SPF record on ${domain}.`,
    };
  }

  // DKIM: the selector given, then the provider's, then common ones.
  const selectors = [
    ...new Set([
      ...(options.dkimSelector ? [options.dkimSelector] : []),
      ...guide.dkimSelectors,
      ...COMMON_DKIM_SELECTORS,
    ]),
  ];
  let dkim: DomainAuthentication["dkim"] = {
    status: "fail",
    selector: null,
    record: null,
    message: guide.consoleUrl
      ? "No DKIM key found. Add the DKIM records your email provider shows for this domain; if it uses a custom selector, enter it to check."
      : "No DKIM key found at common selectors. Enter your mail server's DKIM selector to check it.",
  };
  // Look up every selector and DMARC at once; the first selector (in the
  // order above) with a key wins.
  const cnameSelector =
    options.dkimSelector && guide.dkimCnameTarget ? options.dkimSelector : null;
  const [keys, dmarcFound, cnameTargets] = await Promise.all([
    Promise.all(
      selectors.map(async (selector) => ({
        selector,
        key: (await txt(resolve, `${selector}._domainkey.${domain}`)).find((value) =>
          /(^|;)\s*p=[A-Za-z0-9+/=]{16,}/.test(value),
        ),
      })),
    ),
    findDmarc(resolve, domain),
    cnameSelector
      ? resolveCname(`${cnameSelector}._domainkey.${domain}`).catch(
          () => [] as string[],
        )
      : Promise.resolve([] as string[]),
  ]);
  const found = keys.find((entry) => entry.key);
  const cnameTarget =
    cnameSelector && guide.dkimCnameTarget?.(cnameSelector).toLowerCase();
  if (found?.key) {
    dkim = {
      status: "pass",
      selector: found.selector,
      record: found.key,
      message: `DKIM key found (selector "${found.selector}").`,
    };
  } else if (
    cnameSelector &&
    cnameTargets.some(
      (target) => target.toLowerCase().replace(/\.$/, "") === cnameTarget,
    )
  ) {
    dkim = {
      status: "pass",
      selector: cnameSelector,
      record: `CNAME ${cnameTarget}`,
      message: `DKIM record found (token "${cnameSelector}" points to ${cnameTarget}).`,
    };
  }

  // DMARC
  const policy =
    dmarcFound?.record.match(/(?:^|;)\s*p=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
  const dmarc: DomainAuthentication["dmarc"] = !dmarcFound
    ? {
        status: "fail",
        policy: null,
        record: null,
        message:
          "No DMARC record. Gmail and Yahoo require one from bulk senders; start with p=none to monitor.",
      }
    : !policy || !["none", "quarantine", "reject"].includes(policy)
      ? {
          status: "fail",
          policy,
          record: dmarcFound.record,
          message:
            "The DMARC record has no valid policy (p=none, quarantine or reject).",
        }
      : {
          status: "pass",
          policy,
          record: dmarcFound.record,
          message:
            policy === "none"
              ? `DMARC is monitoring only (p=none${dmarcFound.host === domain ? "" : ` on ${dmarcFound.host}`}). Move to p=quarantine once its reports show only your own mail.`
              : `DMARC policy is p=${policy}${dmarcFound.host === domain ? "" : ` (from ${dmarcFound.host})`}.`,
        };

  const mxPresent = async (record: DnsRecord) => {
    const exchange = record.value?.split(" ")[1]?.toLowerCase();
    const found = await resolveMx(record.name).catch(() => []);
    return found.some(
      (mx) => mx.exchange.toLowerCase().replace(/\.$/, "") === exchange,
    );
  };
  const records: DnsRecord[] = [
    ...(await Promise.all(
      returnPath.map(async (record) => ({
        ...record,
        present:
          record.type === "MX"
            ? await mxPresent(record)
            : record.type === "TXT"
              ? spf.status === "pass"
              : (
                  await resolveCname(record.name).catch(() => [] as string[])
                ).some(
                  (target) => target.toLowerCase().replace(/\.$/, "") === record.value,
                ),
      })),
    )),
    ...(guide.returnPath || managedSpfTarget
      ? []
      : [
          {
            type: "TXT" as const,
            name: domain,
            value: rootSpf[0]
              ? guide.spfInclude && !includes(rootSpf[0], guide.spfInclude)
                ? rootSpf[0].replace(/^v=spf1/i, `v=spf1 include:${guide.spfInclude}`)
                : rootSpf[0]
              : `v=spf1${guide.spfInclude ? ` include:${guide.spfInclude}` : " a mx"} ~all`,
            purpose: "SPF",
            present: spf.status === "pass",
          },
        ]),
    ...guide.dkimRecords(domain).map((record) =>
      record.purpose.startsWith("DKIM")
        ? { ...record, present: dkim.status === "pass" }
        : // The em<id> bounce CNAME: its name is per account, so it's known to
          // be there when automated security is (SendGrid verifies it).
          { ...record, present: Boolean(managedSpfTarget) },
    ),
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: dmarc.record ?? `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`,
      purpose: "DMARC",
      present: dmarc.status === "pass",
    },
  ];

  return {
    domain,
    provider,
    spf,
    dkim,
    dmarc,
    records,
    providerConsoleUrl: guide.consoleUrl,
    checkedAt: new Date().toISOString(),
  };
}
