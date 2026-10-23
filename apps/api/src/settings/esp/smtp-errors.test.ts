import { describe, expect, it } from "bun:test";
import { explainSmtpError } from "./smtp-errors";

const wrongVersion = {
  code: "ESOCKET",
  message: "error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER",
};

describe("explainSmtpError", () => {
  it("explains TLS turned on for a STARTTLS port", () => {
    const message = explainSmtpError(wrongVersion, { port: 587, secure: true });
    expect(message).toStartWith("Port 587 doesn't start with TLS. Turn off Use TLS");
    expect(message).toContain("WRONG_VERSION_NUMBER");
  });

  it("explains TLS turned off for port 465", () => {
    const message = explainSmtpError(
      { code: "ETIMEDOUT", message: "Greeting never received" },
      { port: 465, secure: false },
    );
    expect(message).toStartWith("Port 465 needs Use TLS turned on.");
  });

  it("passes other errors through unchanged", () => {
    const auth = { code: "EAUTH", message: "Invalid login: 535 Authentication failed" };
    expect(explainSmtpError(auth, { port: 587, secure: false })).toBe(auth.message);
    expect(explainSmtpError(wrongVersion, { port: 465, secure: false })).toBe(
      wrongVersion.message,
    );
  });
});
