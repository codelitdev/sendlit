import { runAbuseCli } from "../src/abuse/operator-cli";
import { pool } from "../src/db/client";
import { shutdownObservability } from "../src/observability";

/** Hosted abuse review CLI; see `src/abuse/operator-cli.ts`. */
async function main() {
  let code = 1;
  try {
    code = await runAbuseCli(process.argv.slice(2), {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await pool.end();
    // Operator decisions are PostHog events; send them before exiting.
    await shutdownObservability();
  }
  process.exit(code);
}

void main();
