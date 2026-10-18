import { runBillingCli } from "../src/billing/operator-cli";
import { pool } from "../src/db/client";

/** Operator CLI; see `src/billing/operator-cli.ts` and the README's
 * "Billing operations" section. */
async function main() {
  let code = 1;
  try {
    code = await runBillingCli(process.argv.slice(2), {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await pool.end();
  }
  process.exit(code);
}

void main();
