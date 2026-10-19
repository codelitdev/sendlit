import { getSiteUrl } from "../utils/mail";
import { generatePixelToken } from "../utils/pixel-jwt";

/** Read-only access to Postmaster Tools traffic stats, plus the account's
 * email to show who connected it. */
export const GOOGLE_POSTMASTER_SCOPES = [
  "https://www.googleapis.com/auth/postmaster.traffic.readonly",
  "openid",
  "email",
];

export const GOOGLE_CALLBACK_PATH = "/integrations/google-postmaster/callback";

export function googlePostmasterConfig() {
  const clientId = process.env.GOOGLE_POSTMASTER_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_POSTMASTER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${getSiteUrl()}${GOOGLE_CALLBACK_PATH}`,
    // Overridable so tests and local runs can use a stand-in for Google.
    authorizeUrl:
      process.env.GOOGLE_OAUTH_AUTHORIZE_URL ||
      "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:
      process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token",
    apiUrl:
      process.env.GOOGLE_POSTMASTER_API_URL ||
      "https://gmailpostmastertools.googleapis.com",
  };
}

type Config = NonNullable<ReturnType<typeof googlePostmasterConfig>>;

/** A failure that needs the user to connect again (revoked or expired
 * consent), as opposed to a passing outage. */
export class GoogleReauthorizeError extends Error {}

export function googleAuthorizationUrl(config: Config, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_POSTMASTER_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token on reconnects too.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(config: Config, params: Record<string, string>) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    if (body.error === "invalid_grant") {
      throw new GoogleReauthorizeError("Google access was revoked or expired");
    }
    throw new Error(`Google token request failed: ${body.error ?? response.status}`);
  }
  return body;
}

/** The email in an ID token Google just handed us over TLS. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString(),
    );
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(config: Config, code: string) {
  const body = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  if (typeof body.refresh_token !== "string") {
    throw new Error("Google didn't return a refresh token");
  }
  return {
    refreshToken: body.refresh_token as string,
    email: emailFromIdToken(body.id_token),
  };
}

export async function googleAccessToken(config: Config, refreshToken: string) {
  const body = await tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return body.access_token as string;
}

const METRICS = [
  { name: "spamRate", baseMetric: { standardMetric: "SPAM_RATE" } },
  {
    name: "spfRate",
    baseMetric: { standardMetric: "AUTH_SUCCESS_RATE" },
    filter: 'auth_type = "spf"',
  },
  {
    name: "dkimRate",
    baseMetric: { standardMetric: "AUTH_SUCCESS_RATE" },
    filter: 'auth_type = "dkim"',
  },
  {
    name: "dmarcRate",
    baseMetric: { standardMetric: "AUTH_SUCCESS_RATE" },
    filter: 'auth_type = "dmarc"',
  },
  { name: "deliveryErrorRate", baseMetric: { standardMetric: "DELIVERY_ERROR_RATE" } },
] as const;

export type GoogleMetric = (typeof METRICS)[number]["name"];
export type GoogleDomainDays = Record<string, Partial<Record<GoogleMetric, number>>>;

/** Postmaster Tools doesn't know this domain, or the account can't see it. */
export class GoogleDomainNotFoundError extends Error {}

const toDate = (day: Date) => ({
  year: day.getUTCFullYear(),
  month: day.getUTCMonth() + 1,
  day: day.getUTCDate(),
});

async function api(
  config: Config,
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401)
    throw new GoogleReauthorizeError("Google rejected the access token");
  if (response.status === 403 || response.status === 404) {
    throw new GoogleDomainNotFoundError(String(response.status));
  }
  if (!response.ok)
    throw new Error(`Postmaster Tools request failed: ${response.status}`);
  return (await response.json()) as Record<string, any>;
}

/** Daily stats for one domain over the last `days` days, by ISO day. */
export async function queryGoogleDomainStats(
  config: Config,
  accessToken: string,
  domain: string,
  days = 30,
): Promise<GoogleDomainDays> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const byDay: GoogleDomainDays = {};
  let pageToken: string | undefined;
  do {
    const body = await api(
      config,
      accessToken,
      `/v2/domains/${encodeURIComponent(domain)}/domainStats:query`,
      {
        method: "POST",
        body: JSON.stringify({
          metricDefinitions: METRICS,
          timeQuery: {
            dateRanges: { dateRanges: [{ start: toDate(start), end: toDate(end) }] },
          },
          aggregationGranularity: "DAILY",
          pageSize: 200,
          ...(pageToken && { pageToken }),
        }),
      },
    );
    for (const stat of body.domainStats ?? []) {
      const date = stat.date;
      const metric = stat.metric as GoogleMetric;
      if (!date?.year || !METRICS.some((m) => m.name === metric)) continue;
      const value = stat.value ?? {};
      const number = Number(value.doubleValue ?? value.floatValue ?? value.intValue);
      if (!Number.isFinite(number)) continue;
      const day = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
      byDay[day] = { ...byDay[day], [metric]: number };
    }
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return byDay;
}

export type GoogleCompliance = {
  status: "compliant" | "needs_work" | "unknown";
  needsWork: string[];
};

/** Google's verdict on the bulk-sender requirements for the domain. */
export async function getGoogleCompliance(
  config: Config,
  accessToken: string,
  domain: string,
): Promise<GoogleCompliance> {
  const body = await api(
    config,
    accessToken,
    `/v2/domains/${encodeURIComponent(domain)}/complianceStatus`,
  );
  const data = body.complianceData ?? {};
  const needsWork = new Set<string>();
  for (const row of data.rowData ?? []) {
    if (row?.status?.status === "NEEDS_WORK" && row.requirement)
      needsWork.add(row.requirement);
  }
  for (const [key, verdict] of [
    ["ONE_CLICK_UNSUBSCRIBE", data.oneClickUnsubscribeVerdict?.status?.status],
    ["HONOR_UNSUBSCRIBE", data.honorUnsubscribeVerdict?.status?.status],
    ["DELIVERABILITY", data.deliverabilityStatusVerdict?.state?.status],
  ] as const) {
    if (verdict === "NEEDS_WORK") needsWork.add(key);
  }
  const known = (data.rowData ?? []).length > 0 || data.deliverabilityStatusVerdict;
  return {
    status: needsWork.size > 0 ? "needs_work" : known ? "compliant" : "unknown",
    needsWork: [...needsWork].sort(),
  };
}

/** Starts the Google consent flow; the signed state ties the callback to
 * this team and user. */
export function startGoogleConnect(teamId: string, userId: string | null) {
  const config = googlePostmasterConfig();
  if (!config) return null;
  const state = generatePixelToken(
    { kind: "google_postmaster", teamId, userId },
    "15m",
  );
  return googleAuthorizationUrl(config, state);
}
