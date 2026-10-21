import { readFileSync } from "node:fs";

/** Free mailbox providers. People really sign up with these, so they are
 * flagged rather than blocked by default. */
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "zoho.com",
  "zohomail.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "rediffmail.com",
  "fastmail.com",
  "tutanota.com",
  "hey.com",
]);

/** Shared mailboxes that rarely belong to someone who opted in. */
const ROLE_LOCAL_PARTS = new Set([
  "abuse",
  "admin",
  "billing",
  "careers",
  "contact",
  "help",
  "hello",
  "hr",
  "info",
  "jobs",
  "marketing",
  "newsletter",
  "no-reply",
  "noreply",
  "office",
  "postmaster",
  "root",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

let disposable: Set<string> | null = null;

/** The maintained disposable-email-domains blocklist (about 10k domains),
 * vendored in `disposable-domains.txt` and refreshed weekly by
 * `scripts/update-disposable-domains.ts`. Loaded on first use. */
function disposableDomains(): Set<string> {
  disposable ??= new Set(
    readFileSync(new URL("./disposable-domains.txt", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#")),
  );
  return disposable;
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@").pop() ?? "";
}

/** Disposable/temporary mail domains, including their subdomains. */
export function isDisposableDomain(domain: string): boolean {
  const parts = domain.toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (disposableDomains().has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_PROVIDERS.has(domain.toLowerCase());
}

export function isRoleAddress(email: string): boolean {
  return ROLE_LOCAL_PARTS.has(email.trim().toLowerCase().split("@")[0] ?? "");
}

/** Counts of free, role and disposable addresses, for import reviews. */
export function classifyEmails(emails: string[]) {
  let free = 0;
  let role = 0;
  let disposableCount = 0;
  for (const email of emails) {
    const domain = emailDomain(email);
    if (isFreeEmailDomain(domain)) free++;
    if (isRoleAddress(email)) role++;
    if (isDisposableDomain(domain)) disposableCount++;
  }
  return { total: emails.length, free, role, disposable: disposableCount };
}
