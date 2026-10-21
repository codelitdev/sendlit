import { describe, expect, it } from "bun:test";
import { portForTls, tlsPortMismatch } from "./smtp";

describe("tlsPortMismatch", () => {
  it("flags TLS on 587 and plain on 465", () => {
    expect(tlsPortMismatch("587", true)).toContain("Turn off Use TLS");
    expect(tlsPortMismatch("465", false)).toContain("Turn it on");
  });

  it("accepts the standard pairs and custom ports", () => {
    expect(tlsPortMismatch("587", false)).toBeNull();
    expect(tlsPortMismatch("465", true)).toBeNull();
    expect(tlsPortMismatch("2525", true)).toBeNull();
  });
});

describe("portForTls", () => {
  it("swaps the standard port when TLS is toggled", () => {
    expect(portForTls("587", true)).toBe("465");
    expect(portForTls("465", false)).toBe("587");
  });

  it("leaves custom ports alone", () => {
    expect(portForTls("2525", true)).toBe("2525");
    expect(portForTls("25", false)).toBe("25");
  });
});
