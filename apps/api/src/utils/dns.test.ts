import { describe, expect, it, mock } from "bun:test";

const resolvers: FakeResolver[] = [];
class FakeResolver {
  queried: string[] = [];
  constructor() {
    resolvers.push(this);
  }
  async resolveTxt(name: string) {
    this.queried.push(name);
    if (name.startsWith("slow.")) return new Promise<string[][]>(() => {});
    if (name.startsWith("missing."))
      throw Object.assign(new Error("nx"), { code: "ENOTFOUND" });
    if (name.startsWith("flaky.") && resolvers.length % 2 === 1) {
      return new Promise<string[][]>(() => {});
    }
    return [["v=spf1 -all"]];
  }
  async resolveMx(name: string) {
    this.queried.push(name);
    return [];
  }
  async resolveCname(name: string) {
    this.queried.push(name);
    return [];
  }
}
const realDns = await import("node:dns");
mock.module("node:dns", () => ({
  ...realDns,
  promises: { ...realDns.promises, Resolver: FakeResolver },
}));

const { freshDnsLookups } = await import("./dns");

describe("freshDnsLookups", () => {
  it("uses a new resolver for every lookup, so no answer is reused", async () => {
    const lookups = freshDnsLookups();
    await lookups.resolveTxt("example.com");
    await lookups.resolveTxt("example.com");
    await lookups.resolveMx("mail.example.com");
    expect(resolvers).toHaveLength(3);
  });

  it("queries absolute names so search domains aren't tried", async () => {
    resolvers.length = 0;
    const lookups = freshDnsLookups();
    await lookups.resolveTxt("_dmarc.example.com");
    await lookups.resolveCname("s1._domainkey.example.com.");
    expect(resolvers.flatMap((resolver) => resolver.queried)).toEqual([
      "_dmarc.example.com.",
      "s1._domainkey.example.com.",
    ]);
  });

  it("gives up on a lookup that never answers, after three attempts", async () => {
    resolvers.length = 0;
    await expect(freshDnsLookups(20).resolveTxt("slow.example.com")).rejects.toThrow(
      "dns_timeout",
    );
    expect(resolvers).toHaveLength(3);
  });

  it("retries a lost query with a new one", async () => {
    resolvers.length = 0;
    await expect(freshDnsLookups(20).resolveTxt("flaky.example.com")).resolves.toEqual([
      ["v=spf1 -all"],
    ]);
    expect(resolvers).toHaveLength(2);
  });

  it("doesn't retry a definite 'no such record'", async () => {
    resolvers.length = 0;
    await expect(freshDnsLookups(20).resolveTxt("missing.example.com")).rejects.toThrow(
      "nx",
    );
    expect(resolvers).toHaveLength(1);
  });
});
