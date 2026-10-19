import { positiveInt } from "../billing/reputation-config";

/**
 * Hosted abuse controls (#75) run only in the cloud deployment and can be
 * switched off with `ABUSE_CONTROLS=off`. Self-hosted (OSS) installs never
 * run them.
 */
export function abuseControlsEnabled(): boolean {
  return (
    process.env.SENDLIT_DEPLOYMENT_MODE === "cloud" &&
    process.env.ABUSE_CONTROLS !== "off"
  );
}

function choice<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!values.includes(raw as T)) throw new Error(`${name}_invalid`);
  return raw as T;
}

export type AbuseConfig = {
  /** Reject signups from disposable/temporary email domains. */
  blockDisposableSignups: boolean;
  /** What to do with signups from free mailbox providers such as gmail.com. */
  freeEmailSignupPolicy: "allow" | "flag" | "block";
  /** New accounts allowed per client IP per UTC day. */
  signupsPerIpPerDay: number;
  /** Optional real-person check at signup. */
  signupRiskCheck: "off" | "exa";
  /** Accounts younger than this get stricter import thresholds and paced
   * marketing sends. */
  newAccountDays: number;
  /** Imported contacts in 24 hours that alert operators. */
  importAlertContacts: number;
  importAlertContactsNewAccount: number;
  /** An import that grows the list by this factor in 24 hours alerts too. */
  importAlertGrowthFactor: number;
  /** Hold campaigns of new accounts with a flagged import until reviewed. */
  holdLargeImportsOfNewAccounts: boolean;
  /** New accounts' daily marketing allowance is spread over this many hours. */
  pacingHours: number;
  /** Scan marketing emails before they are started: heuristics only, or
   * heuristics plus an AI classifier. */
  contentScan: "off" | "heuristic" | "ai";
};

export function readAbuseConfig(): AbuseConfig {
  return {
    blockDisposableSignups: process.env.SIGNUP_BLOCK_DISPOSABLE !== "false",
    freeEmailSignupPolicy: choice(
      "SIGNUP_FREE_EMAIL_POLICY",
      ["allow", "flag", "block"] as const,
      "flag",
    ),
    signupsPerIpPerDay: positiveInt("SIGNUP_IP_DAILY_LIMIT", 3),
    signupRiskCheck: choice("SIGNUP_RISK_CHECK", ["off", "exa"] as const, "off"),
    newAccountDays: positiveInt("ABUSE_NEW_ACCOUNT_DAYS", 30, 365),
    importAlertContacts: positiveInt("IMPORT_ALERT_CONTACTS", 5_000),
    importAlertContactsNewAccount: positiveInt(
      "IMPORT_ALERT_CONTACTS_NEW_ACCOUNT",
      1_000,
    ),
    importAlertGrowthFactor: positiveInt("IMPORT_ALERT_GROWTH_FACTOR", 3, 1_000),
    holdLargeImportsOfNewAccounts: process.env.IMPORT_HOLD_NEW_ACCOUNTS !== "false",
    pacingHours: positiveInt("PACING_HOURS", 12, 24),
    contentScan: choice(
      "CONTENT_SCAN",
      ["off", "heuristic", "ai"] as const,
      process.env.ANTHROPIC_API_KEY ? "ai" : "heuristic",
    ),
  };
}
