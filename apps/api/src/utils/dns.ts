import { promises as dns } from "node:dns";

/** `dns.resolveTxt` that gives up after `timeoutMs`. */
export function resolveTxtWithTimeout(
  name: string,
  timeoutMs = 5_000,
): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns_timeout")), timeoutMs);
    dns.resolveTxt(name).then(
      (records) => {
        clearTimeout(timer);
        resolve(records);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
